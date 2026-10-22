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
//   5. Single-active-token policy via mint_talaria_claim() RPC (advisory-locked
//      revoke-then-insert). Concurrent mints used to race the partial unique
//      index and 500.
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

const CLAIM_TTL_DAYS = 30

export async function POST() {

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "This endpoint is not configured on this deployment." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
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
  if (!user?.id) {
    const clerk = await clerkClient()
    const u = await clerk.users.getUser(userId)
    const email = u.emailAddresses[0]?.emailAddress
    if (!email) {
      return NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    }
    const role =
      u.publicMetadata?.role === "admin" || u.privateMetadata?.role === "admin"
        ? "admin"
        : "member"
    const { data: nu, error: upErr } = await supabase
      .from("users")
      .upsert({ clerk_user_id: userId, email, role }, { onConflict: "clerk_user_id" })
      .select("id")
      .maybeSingle()
    user = nu
    if (!user?.id) {
      const { data: again } = await supabase
        .from("users")
        .select("id")
        .eq("clerk_user_id", userId)
        .maybeSingle()
      user = again
    }
    if (!user?.id) {
      return NextResponse.json(
        { error: upErr?.message || "user_row_missing" },
        { status: 500 }
      )
    }
  }

  // 3. Most recent subscription that currently entitles access (active/grace)
  //    NOTE: must select plans.id — the insert below requires plan_id and the
  //    NOT NULL constraint on talaria_claims.plan_id fails if id is missing.
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, status, plan_id, plans(id, slug, title)")
    .eq("user_id", user.id)
    .in("status", ["active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const planId = subscription?.plans?.id ?? subscription?.plan_id ?? null
  if (!subscription || !planId) {
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

  // 5. Atomic revoke-then-insert (advisory lock inside the RPC).
  const { data: minted, error: rpcErr } = await supabase.rpc("mint_talaria_claim", {
    p_user_id: user.id,
    p_plan_id: planId,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  })

  if (rpcErr || !minted?.ok) {
    return NextResponse.json(
      { error: rpcErr?.message || minted?.error || "mint_failed" },
      { status: 500 }
    )
  }

  // 6. Return the raw token — the ONLY time it is ever transmitted back.
  return NextResponse.json({
    token,
    expires_at: expiresAt,
    plan_title: minted.plan_title ?? subscription.plans?.title ?? null,
    plan_slug: minted.plan_slug ?? subscription.plans?.slug ?? null,
  })
}
