// =============================================================================
// Noble Trading App — Next.js API Route: create-subscription
// =============================================================================
// Called by the portal page when a user picks a plan. Creates a `pending`
// subscription row in Supabase and returns its id, which the client passes
// to <HelioCheckout> via additionalJSON. The Helio webhook later updates
// this row to `active` / `grace` / `expired`.
//
//   POST /api/create-subscription
//   body: { planId: string }
//   →   { subscriptionId: string, paylinkId: string }
//
// Why a pending row up front?
//   1. Helio webhooks are correlated to users via additionalJSON.subscription_id
//      (Helio itself doesn't track user identity).
//   2. If the user abandons checkout, the pending row is harmless and queryable.
//   3. The unique index subscriptions_one_active_per_plan_idx prevents dupes.
// =============================================================================

import { NextResponse } from "next/server"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

// Service-role client (server-only). Bypasses RLS.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function POST(req) {
  // 1. Auth — must be signed in
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { planId } = await req.json()
  if (!planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 })
  }

  // 2. Fetch the plan (to get paylinkId + verify it's active)
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, helio_paylink_id, is_active, title")
    .eq("id", planId)
    .single()
  if (planErr || !plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }
  if (!plan.is_active) {
    return NextResponse.json({ error: "Plan not available" }, { status: 400 })
  }

  // 3. Upsert the local user row (mirror Clerk user → Supabase users)
  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const email = user.emailAddresses[0]?.emailAddress
  if (!email) {
    return NextResponse.json(
      { error: "No email on Clerk user" },
      { status: 400 }
    )
  }
  await supabase.from("users").upsert(
    {
      clerk_user_id: userId,
      email,
      discord_id: user.publicMetadata?.discordId ?? null,
      discord_username: user.publicMetadata?.discordUsername ?? null,
      role: user.publicMetadata?.role === "admin" ? "admin" : "member"
    },
    { onConflict: "clerk_user_id" }
  )
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .single()

  // 4. Create the pending subscription row.
  //    The unique index on (user_id, plan_id) WHERE status IN (pending,active,grace)
  //    means if they already have an active sub to this plan, this 409s.
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .insert({
      user_id: localUser.id,
      plan_id: plan.id,
      helio_paylink_id: plan.helio_paylink_id,
      status: "pending"
    })
    .select("id")
    .single()

  if (subErr) {
    if (subErr.code === "23505") {
      // unique violation — already have an active/pending sub to this plan
      return NextResponse.json(
        { error: "You already have an active subscription to this plan." },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: subErr.message }, { status: 500 })
  }

  // 5. Log CHECKOUT_INITIATED in the audit trail
  await supabase.from("subscription_events").insert({
    subscription_id: sub.id,
    event_type: "CHECKOUT_INITIATED",
    helio_paylink_id: plan.helio_paylink_id,
    raw_payload: { planId, userId, createdAt: new Date().toISOString() }
  })

  // 5b. HYBRID AUTH PATTERN — mirror `subscriptionStatus=pending` + plan title
  //     into Clerk publicMetadata NOW so the portal's instant badge (which
  //     reads from the JWT) flips to "Pending" before the webhook fires.
  //     The webhook later overwrites this with `active` / `grace` / `expired`.
  try {
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: {
        subscriptionStatus: "pending",
        plan: plan.title
      }
    })
  } catch (e) {
    // Non-fatal — the webhook will sync the truth on success.
    console.error("Clerk metadata sync (pending) failed:", e)
  }

  // 6. Return the subscription id + paylink id for the HelioCheckout widget
  return NextResponse.json({
    subscriptionId: sub.id,
    paylinkId: plan.helio_paylink_id
  })
}
