// =============================================================================
// Noble Trading App — Next.js API Route: talaria-claim
// =============================================================================
// Mints a claim token for the Talaria desktop client (Hermes plugin).
//
//   POST /api/talaria-claim
//   → 200 { token, expires_at, plan_title, plan_slug }
//   → 401 { error: "Unauthorized" }                 — not signed in
//   → 403 { error: "no_active_subscription" }       — no active/grace sub
//   → 500 { error: <message> }                      — insert failure
//
// Flow:
//   1. Clerk auth — must be signed in.
//   2. Resolve the local users row (upsert first-timers from Clerk, mirroring
//      /api/subscription-status).
//   3. Require the user's most recent subscription to be in status
//      active | grace (joined to plans for slug + title). A lapsed/expired
//      subscription gets no token.
//   4. Mint a 32-byte hex token (node:crypto) and store ONLY its SHA-256 hash
//      in talaria_claims — the raw token is returned exactly once and can
//      never be recovered from the DB.
//   5. Single-active-token policy: revoke the user's other non-revoked
//      claims, then insert the new one with a 30-day expiry.
//
// The Talaria client presents this token to the talaria-check Edge Function,
// which re-checks the LIVE subscriptions row on every call — the token only
// proves identity; the subscription row decides access.
// =============================================================================

import { NextResponse } from "next/server"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "node:crypto"

// Service-role client (server-only). Bypasses RLS.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const CLAIM_TTL_DAYS = 30

export async function POST() {
  // 1. Auth — must be signed in
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 2. Resolve the local user row. First-time visitors are upserted from
  //    Clerk so they exist (same pattern as /api/subscription-status).
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle()

  let user = localUser
  if (!user) {
    const clerk = await clerkClient()
    const u = await clerk.users.getUser(userId)
    const email = u.emailAddresses[0]?.emailAddress
    if (!email) {
      return NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    }
    await supabase.from("users").upsert(
      {
        clerk_user_id: userId,
        email,
        role: u.publicMetadata?.role === "admin" ? "admin" : "member"
      },
      { onConflict: "clerk_user_id" }
    )
    const { data: nu } = await supabase
      .from("users")
      .select("id")
      .eq("clerk_user_id", userId)
      .single()
    user = nu
  }

  // 3. Most recent subscription that currently entitles access (active/grace)
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, status, plans(slug, title)")
    .eq("user_id", user.id)
    .in("status", ["active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!subscription) {
    return NextResponse.json(
      { error: "no_active_subscription" },
      { status: 403 }
    )
  }

  // 4. Mint: 32 random bytes → 64-char hex token. Store only sha256(token).
  const token = crypto.randomBytes(32).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex")
  const expiresAt = new Date(
    Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // 5. Single-active-token policy: revoke every other live claim for this
  //    user (best-effort; the partial unique index in migration 0006 is the
  //    DB-level backstop).
  await supabase
    .from("talaria_claims")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .neq("token_hash", tokenHash)

  // 6. Insert the new claim (30-day expiry)
  const { error: insertErr } = await supabase
    .from("talaria_claims")
    .insert({
      token_hash: tokenHash,
      user_id: user.id,
      plan_id: subscription.plans.id,
      expires_at: expiresAt
    })

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // 7. Return the raw token — the ONLY time it is ever transmitted back.
  return NextResponse.json({
    token,
    expires_at: expiresAt,
    plan_title: subscription.plans.title,
    plan_slug: subscription.plans.slug
  })
}
