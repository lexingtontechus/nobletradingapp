// =============================================================================
// Noble Trading App — Next.js API Route: subscription-status
// =============================================================================
// Single endpoint the portal calls to render the user's full subscription
// state. Replaces the old pattern of polling Clerk user.reload() every 30s +
// reading publicMetadata.
//
//   GET /api/subscription-status
//   → {
//       user: { email, discord_id, discord_username, role },
//       subscription: { id, status, plan_title, plan_slug, current_period_end,
//                       grace_period_end, next_charge_url, reminder_count } | null,
//       payments: [{ id, amount_cents, paid_at, is_renewal, token_symbol }],
//       events: [{ event_type, received_at }]
//     }
//
// Perf notes:
//   * Per-user in-process cache 30s (portal polls; avoids re-querying).
//   * Clerk getUser only when the local users row is missing (first visit).
//   * Subscription + payments run in parallel; events piggyback when we have
//     a subscription id.
// =============================================================================

import { NextResponse } from "next/server"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"
import { cached } from "@/utils/api-cache"
import { isCurrentSubscription } from "@/utils/subscription-access"

// Lazy singleton: createClient throws at module load when env is absent,
// which takes down every route in the app at import time. Absent config
// becomes a null client the handler turns into a clean 503 instead.
let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

async function loadSubscriptionState(supabase, userId) {
  // 1. Resolve local user
  const { data: localUser } = await supabase
    .from("users")
    .select("id, email, discord_id, discord_username, role")
    .eq("clerk_user_id", userId)
    .maybeSingle()

  if (!localUser) {
    // First-time visitor — upsert from Clerk so they exist
    const clerk = await clerkClient()
    const u = await clerk.users.getUser(userId)
    const email = u.emailAddresses[0]?.emailAddress
    if (!email) {
      return { error: "No email on Clerk user", status: 400 }
    }
    await supabase.from("users").upsert(
      {
        clerk_user_id: userId,
        email,
        role:
          u.publicMetadata?.role === "admin" ||
          u.privateMetadata?.role === "admin"
            ? "admin"
            : "member"
      },
      { onConflict: "clerk_user_id" }
    )
    const { data: nu } = await supabase
      .from("users")
      .select("id, email, discord_id, discord_username, role")
      .eq("clerk_user_id", userId)
      .maybeSingle()
    return {
      user: nu,
      subscription: null,
      payments: [],
      events: []
    }
  }

  // 2–3. Subscription + payments in parallel
  const [subRes, payRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        `id, status, current_period_start, current_period_end, grace_period_end,
         helio_paylink_id,
         next_charge_url, next_charge_token, next_charge_expires_at,
         helio_email, helio_discord_id, helio_discord_username,
         reminder_count, last_reminder_sent_at, cancelled_at, created_at,
         plans(id, title, description, price_cents, currency, interval,
               helio_paylink_id, slug)`
      )
      .eq("user_id", localUser.id)
      .in("status", ["pending", "active", "grace"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("payment_transactions")
      .select(
        "id, amount_cents, amount_decimal, token_symbol, is_renewal, paid_at, status"
      )
      .eq("user_id", localUser.id)
      .order("paid_at", { ascending: false })
      .limit(10),
  ])
  const subscription = subRes?.data ?? null
  const payments = payRes?.data ?? []

  // 4. Recent events (last 5) — needs subscription.id
  let events = []
  if (subscription?.id) {
    const { data: ev } = await supabase
      .from("subscription_events")
      .select("event_type, amount_cents, currency, received_at")
      .eq("subscription_id", subscription.id)
      .order("received_at", { ascending: false })
      .limit(5)
    events = ev ?? []
  }

  return {
    user: localUser,
    subscription,
    payments,
    events
  }
}

export async function GET() {

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "This endpoint is not configured on this deployment." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = await cached(`sub:${userId}`, 30_000, () =>
    loadSubscriptionState(supabase, userId)
  )

  if (payload?.error) {
    return NextResponse.json(
      { error: payload.error },
      { status: payload.status || 500 }
    )
  }

  return NextResponse.json(
    {
      user: payload.user,
      subscription: payload.subscription,
      payments: payload.payments,
      events: payload.events,
      // Date-aware access state. `subscription.status` alone is driven only by
      // Helio ENDED webhooks and can stay "active" long after the period
      // lapsed (migration 0033's cron repairs the row; this is the guard).
      isCurrent: isCurrentSubscription(payload.subscription),
    },
    { headers: { "Cache-Control": "private, max-age=15" } }
  )
}
