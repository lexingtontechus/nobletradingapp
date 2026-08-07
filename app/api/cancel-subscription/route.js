// =============================================================================
// Noble Trading App — Next.js API Route: cancel-subscription
// =============================================================================
// User-initiated cancel. Marks the subscription as `cancelled` so the reminder
// cron stops nagging. The subscription remains active until current_period_end
// (Helio doesn't refund the current cycle), then naturally expires.
//
//   POST /api/cancel-subscription
//   body: { subscriptionId: string, reason?: string }
//   →   { ok: true }
//
// Note: this does NOT call Helio's API to cancel — because Helio subscriptions
// are "renewal reminder + charge" based, simply not paying the next charge is
// the cancellation. If you want to disable the paylink entirely (cancel for
// ALL users), disable the paylink in the Helio dashboard.
// =============================================================================

import { NextResponse } from "next/server"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

export async function POST(req) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { subscriptionId, reason } = await req.json()
  if (!subscriptionId) {
    return NextResponse.json(
      { error: "subscriptionId required" },
      { status: 400 }
    )
  }

  // Verify ownership: resolve local user from Clerk id, then check the sub belongs to them.
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .single()
  if (!localUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const { data: sub, error } = await supabase
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason ?? null,
      // Clear the pending charge so the cron doesn't keep reminding
      next_charge_url: null,
      next_charge_token: null
    })
    .eq("id", subscriptionId)
    .eq("user_id", localUser.id) // ownership guard
    .in("status", ["active", "grace"]) // can only cancel an active/grace sub
    .select("id")
    .single()

  if (error || !sub) {
    return NextResponse.json(
      { error: "Subscription not found or not cancellable" },
      { status: 404 }
    )
  }

  // 5. HYBRID AUTH PATTERN — mirror `subscriptionStatus=cancelled` into Clerk
  //    publicMetadata so the portal's instant badge updates immediately. The
  //    subscription remains active until current_period_end (Helio doesn't
  //    refund the current cycle), but the badge reflects the user's intent.
  try {
    const clerk = await clerkClient()
    await clerk.users.updateUserMetadata(userId, {
      publicMetadata: { subscriptionStatus: "cancelled" }
    })
  } catch (e) {
    // Non-fatal — Supabase is already updated; the badge will sync on next webhook.
    console.error("Clerk metadata sync (cancel) failed:", e)
  }

  return NextResponse.json({ ok: true })
}
