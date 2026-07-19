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
//       subscription: { id, status, plan_title, current_period_end,
//                       grace_period_end, next_charge_url, reminder_count } | null,
//       payments: [{ id, amount_cents, paid_at, is_renewal, token_symbol }],
//       events: [{ event_type, received_at }]
//     }
//
// Why a dedicated endpoint instead of client-side Supabase reads?
//   1. Single round-trip (vs. 3 separate client queries).
//   2. The service role key stays server-side; the browser never sees it.
//   3. We can shape the payload for the UI (e.g. only last 10 payments).
//   4. Future: add Supabase Realtime subscription on the client to push
//      updates instead of polling this endpoint.
// =============================================================================

import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Resolve local user
  const { data: localUser } = await supabase
    .from("users")
    .select("id, email, discord_id, discord_username, role")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!localUser) {
    // First-time visitor — upsert from Clerk so they exist
    const clerk = await clerkClient();
    const u = await clerk.users.getUser(userId);
    const email = u.emailAddresses[0]?.emailAddress;
    if (email) {
      await supabase.from("users").upsert({
        clerk_user_id: userId,
        email,
        role: (u.publicMetadata as any)?.role === "admin" ? "admin" : "member",
      }, { onConflict: "clerk_user_id" });
      const { data: nu } = await supabase
        .from("users")
        .select("id, email, discord_id, discord_username, role")
        .eq("clerk_user_id", userId)
        .maybeSingle();
      return NextResponse.json({ user: nu, subscription: null, payments: [], events: [] });
    }
    return NextResponse.json({ error: "No email on Clerk user" }, { status: 400 });
  }

  // 2. Most recent active/grace/pending subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(`
      id, status, current_period_start, current_period_end, grace_period_end,
      next_charge_url, next_charge_token, next_charge_expires_at,
      helio_email, helio_discord_id, helio_discord_username,
      reminder_count, last_reminder_sent_at, cancelled_at, created_at,
      plans(id, title, description, price_cents, currency, interval)
    `)
    .eq("user_id", localUser.id)
    .in("status", ["pending", "active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. Payment history (last 10)
  const { data: payments } = await supabase
    .from("payment_transactions")
    .select("id, amount_cents, amount_decimal, token_symbol, is_renewal, paid_at, status")
    .eq("user_id", localUser.id)
    .order("paid_at", { ascending: false })
    .limit(10);

  // 4. Recent events (last 5)
  let events: any[] = [];
  if (subscription) {
    const { data: ev } = await supabase
      .from("subscription_events")
      .select("event_type, amount_cents, currency, received_at")
      .eq("subscription_id", subscription.id)
      .order("received_at", { ascending: false })
      .limit(5);
    events = ev ?? [];
  }

  return NextResponse.json({
    user: localUser,
    subscription,
    payments: payments ?? [],
    events,
  });
}
