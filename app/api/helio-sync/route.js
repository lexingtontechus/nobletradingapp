// =============================================================================
// Noble Trading App — API Route: helio-sync
// =============================================================================
// Server-side trigger for the helio-subscription-sync Edge Function.
//
// WHY THIS EXISTS (2026-08-09):
//   The 15-minute pg_cron schedule is too slow for the checkout UX. When a
//   user completes a payment, the Helio widget fires onSuccess in the browser
//   — at that moment the subscription row is still `pending` and the portal
//   polls /api/subscription-status every 3s. But the row only flips when the
//   webhook OR the cron poller reconciles it. This route lets the client fire
//   the reconciliation IMMEDIATELY on payment success, so the portal's 3s
//   poll sees the row flip within seconds instead of waiting up to 15 min.
//
//   POST /api/helio-sync
//   body: { subscriptionId?: string, planId?: string }   (optional; used for
//         targeted re-sync — the edge function also does a full sweep)
//   →  { ok: true, summary: {...} } | { ok: false, error: string }
//
// Auth: requires a signed-in Clerk session (prevents anonymous abuse of the
// edge function which is verify_jwt:false by design for pg_cron).
// =============================================================================

import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const EDGE_URL = `${SUPABASE_URL}/functions/v1/helio-subscription-sync`

export async function POST(req) {
  // 1. Must be signed in (the sync reconciles the caller's own subscription)
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body = {}
  try {
    body = await req.json()
  } catch {
    // no body / non-JSON — fine, full sweep
  }

  // 2. Invoke the edge function. It accepts X-Supabase-Cron (the pg_cron
  //    path) — the same marker the scheduled job sends. Service-role bearer
  //    would also work; this keeps the route secret-free.
  try {
    const resp = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Supabase-Cron": "true",
      },
      body: JSON.stringify({
        subscriptionId: body.subscriptionId ?? null,
        planId: body.planId ?? null,
      }),
    })
    const text = await resp.text()
    let summary = null
    try {
      summary = JSON.parse(text)
    } catch {
      summary = { raw: text }
    }
    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `Sync failed (${resp.status})`, summary },
        { status: 502 }
      )
    }
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    console.error("helio-sync invoke error:", e)
    return NextResponse.json(
      { ok: false, error: e.message ?? String(e) },
      { status: 502 }
    )
  }
}
