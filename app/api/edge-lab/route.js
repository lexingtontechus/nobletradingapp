// =============================================================================
// Noble Trading App — Edge Lab Data API Route
// =============================================================================
// Serves the latest Kairos Edge Lab run from v_edge_lab_run (Supabase).
//
// ACCESS MODEL: subscriber-only.
//   The artifact is a proprietary engine audit, so nt_edge_lab_run stays
//   service-role-only (migration 0032) and the gate lives in this route:
//     1. Clerk auth()        → 401 when not signed in
//     2. subscriptions row   → 403 unless status ∈ {pending, active, grace}
//   The server secret is read server-side only and is never shipped to the
//   browser. The DB — not the client — stays the enforcement point.
//
// NOTE: nt_edge_lab_run has NO `id` column — its key is `run_id`. The column
// list below matches information_schema exactly.
//
// The payload JSONB is spread at the top level so page.jsx can read
// data.meta / data.verdicts / data.fixes directly.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { hasSubscriberAccess } from "@/utils/subscription-access";

// The source route declared this explicitly; auth() already forces dynamic,
// but keep it so a future caching default cannot freeze the artifact.
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase's prescribed server-side key name (sb_secret_...). The old
// service-role env name is deprecated — it is NOT read here and there is no
// fallback.
const secretKey = process.env.SUPABASE_SECRET_KEY;

// Built lazily so a missing env degrades to a clear 503 instead of a
// module-load crash that 500s every route in the app.
function getClient() {
  if (!supabaseUrl || !secretKey) return null;
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });
}

const inMemoryCache = new Map(); // cache_key -> { data, timestamp }

// Subscriber gate — mirrors the /dashboard plan-status gate.
//
// Admin is the TOP of the gate: full access regardless of subscription state,
// so a lapsed (or absent) subscription never locks an admin out.
async function assertSubscriber(client, userId) {
  const { data: localUser } = await client
    .from("users")
    .select("id, role")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!localUser) {
    return { ok: false, status: 403, error: "No subscriber record." };
  }

  if (localUser.role === "admin") {
    return { ok: true };
  }

  const { data: sub } = await client
    .from("subscriptions")
    .select(
      "id, status, current_period_end, grace_period_end, created_at",
    )
    .eq("user_id", localUser.id)
    .in("status", ["pending", "active", "grace"])
    // subscriptions_one_active_per_plan_idx is unique per (user_id, plan_id),
    // not per user — a multi-plan subscriber has 2+ rows, and .maybeSingle()
    // on a multi-row result fails closed with PGRST116, bouncing a paying
    // subscriber to /welcome. Mirror the /api/subscription-status gate.
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Date-aware: a row can still read `active` long after the period lapsed
  // (status is driven only by Helio ENDED webhooks).
  if (!hasSubscriberAccess(sub)) {
    return { ok: false, status: 403, error: "Active subscription required." };
  }
  return { ok: true };
}

export async function GET() {
  const client = getClient();

  if (!client) {
    return NextResponse.json(
      {
        error:
          "Edge Lab is not configured: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY are not set.",
        configured: false,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const gate = await assertSubscriber(client, userId);
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.status, headers: { "cache-control": "no-store" } },
    );
  }

  const cacheKey = "edge-lab-data";
  const cached = inMemoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      // `private` + `s-maxage` contradict each other; the page fetches with
      // cache:"no-store" anyway, so keep it browser-private only.
      headers: { "cache-control": "private, max-age=300" },
    });
  }

  const { data, error } = await client
    .from("v_edge_lab_run")
    .select(
      "run_id, generated_at, engine, symbols, period_start, period_end, bars_total, note, payload",
    )
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[edge-lab] fetch failed:", error.message);
    return NextResponse.json(
      // Do not echo the driver error back to the browser — PostgREST/Postgres
      // messages can leak table/column names. It is logged above.
      { error: "Could not load edge-lab data." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No edge-lab runs found in nt_edge_lab_run.", warming: true },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const payload = data.payload || {};
  const result = {
    run_id: data.run_id,
    generated_at: data.generated_at,
    engine: data.engine ?? payload?.meta?.engine ?? "regime_edge v1",
    symbols: data.symbols ?? payload?.meta?.symbols ?? [],
    period_start: data.period_start ?? payload?.meta?.period_start,
    period_end: data.period_end ?? payload?.meta?.period_end,
    bars_total: data.bars_total,
    note: data.note,
    ...payload,
    meta: {
      ...(payload?.meta ?? {}),
      run_id: data.run_id,
      generated_at: data.generated_at,
    },
  };

  inMemoryCache.set(cacheKey, { data: result, timestamp: Date.now() });

  return NextResponse.json(result, {
    headers: { "cache-control": "private, max-age=300" },
  });
}
