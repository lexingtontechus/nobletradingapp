// =============================================================================
// Noble Trading App — Next.js API Route: dashboard-data
// =============================================================================
// Serves all dashboard view data in a single request — replaces the MOCK_*
// constants in app/dashboard/page.jsx with real data from the Supabase views.
//
//   GET /api/dashboard-data
//   → {
//       sweeps: [...],              — v_talaria_latest_signals (latest sweep per symbol)
//       signalHealth: [...],        — v_talaria_signal_health
//       calibration: [...],         — v_eod_calibration_bias_latest
//       calibrationBoard: [...],    — v_calibration_confidence_board (L1 honest status, 28d)
//       outcomeBySide: [...],       — v_signal_outcome_by_side (L3 geometry, buy vs sell)
//       vsEqual: [...],             — v_paper_vs_optimized_daily (incommensurate units — context only)
//       vsEqualAligned: [...],      — v_paper_vs_equalwt_aligned (R5 unit-aligned L1 benchmark)
//       vsEqualSymbol: [...],       — v_paper_vs_optimized_symbol (Precision Pro only)
//       portfolioStats: {...|null}, — v_talaria_portfolio_stats (Precision Pro only)
//       renkoBricks: [...],         — v_talaria_renko (last 10 per symbol)
//       kelly: [...],               — derived from latest_signals (same rows)
//       symbols: [...],             — v_talaria_symbols (plan-gated; admin = all active)
//       paperPositions: [...],      — v_paper_positions (Precision Pro only)
//       paperEquity: [...],         — v_paper_equity (Precision Pro only)
//       planSlug, isPro, isAdmin
//     }
//
// Perf: prefer the single-row talaria_dashboard_cache payload (refreshed by
// pg_cron every 2 min). Live fan-out is only a cold-start fallback — 13
// concurrent PostgREST view queries stampede to 6–10s under load.
//
// Admin: full roster + Pro analytics regardless of subscription/plan.
// Members: plan_ids containment on v_talaria_symbols (uuid[] → cs.{uuid}).
// Uses the service role key (server-only). Missing views degrade to [].
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { roleFromLocalUser, checkRole } from "@/utils/roles";
import { cached } from "@/utils/api-cache";

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

function safeData(res) {
  if (res?.data) return res.data;
  return [];
}

function safeSingle(res) {
  if (res?.data) return res.data;
  return null;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function emptyBundle() {
  return {
    sweeps: [],
    signalHealth: [],
    calibration: [],
    calibrationBoard: [],
    outcomeBySide: [],
    renkoBricks: [],
    vsEqual: [],
    vsEqualAligned: [],
    vsEqualSymbol: [],
    portfolioStats: null,
    kelly: [],
    symbols: [],
    paperPositions: [],
    paperEquity: [],
    regimeEdge: [],
  };
}

async function loadCachedBundle(supabase) {
  const { data, error } = await supabase
    .from("talaria_dashboard_cache")
    .select("payload, refreshed_at")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data?.payload) return null;
  const p = data.payload;
  return {
    sweeps: arr(p.sweeps),
    signalHealth: arr(p.signalHealth),
    calibration: arr(p.calibration),
    calibrationBoard: arr(p.calibrationBoard),
    outcomeBySide: arr(p.outcomeBySide),
    renkoBricks: arr(p.renkoBricks),
    vsEqual: arr(p.vsEqual),
    vsEqualAligned: arr(p.vsEqualAligned),
    portfolioStats: p.portfolioStats ?? null,
    symbols: arr(p.symbols),
    paperPositions: arr(p.paperPositions),
    paperEquity: arr(p.paperEquity),
    vsEqualSymbol: arr(p.vsEqualSymbol),
    regimeEdge: arr(p.regimeEdge),
    deadlineTiers: arr(p.deadlineTiers),
    geometryRisk: arr(p.geometryRisk),
    kairosPivots: arr(p.kairosPivots),
    health: p.health ?? null,
    refreshed_at: data.refreshed_at,
  };
}

async function loadLiveBundle(supabase) {
  let symbolsQuery = supabase
    .from("v_talaria_symbols")
    .select("*")
    .eq("active", true);

  const [
    sweepsRes,
    healthRes,
    calibrationRes,
    calibrationBoardRes,
    outcomeBySideRes,
    renkoRes,
    vsEqualRes,
    vsEqualAlignedRes,
    portfolioRes,
    symbolsRes,
    paperPositionsRes,
    paperEquityRes,
    vsEqualSymbolRes,
    regimeEdgeRes,
    deadlineTiersRes,
    geometryRiskRes,
    kairosPivotsRes,
  ] = await Promise.all([
    supabase.from("v_talaria_latest_signals").select("*"),
    supabase.from("v_talaria_signal_health").select("*"),
    supabase.from("v_eod_calibration_bias_latest").select("*"),
    supabase.from("v_calibration_confidence_board").select("*"),
    supabase.from("v_signal_outcome_by_side").select("*").eq("qualified", true),
    supabase
      .from("v_talaria_renko")
      .select("*")
      .order("session_date", { ascending: false })
      .order("brick_index", { ascending: false })
      .limit(400),
    supabase.from("v_paper_vs_optimized_daily").select("*"),
    supabase.from("v_paper_vs_equalwt_aligned").select("*"),
    supabase.from("v_talaria_portfolio_stats").select("").maybeSingle(),
    symbolsQuery,
    supabase.from("v_paper_positions").select("*").limit(200),
    supabase.from("v_paper_equity").select("*"),
    supabase.from("v_paper_vs_optimized_symbol").select("*"),
    supabase.from("nt_regime_edge").select("*").limit(1000),
    supabase.from("v_talaria_deadline_tiers").select("*"),
    supabase.from("v_talaria_geometry_risk").select("*"),
    supabase.from("v_talaria_kairos_pivots").select("*"),
  ]);

  return {
    sweeps: safeData(sweepsRes),
    signalHealth: safeData(healthRes),
    calibration: safeData(calibrationRes),
    calibrationBoard: safeData(calibrationBoardRes),
    outcomeBySide: safeData(outcomeBySideRes),
    renkoBricks: safeData(renkoRes),
    vsEqual: safeData(vsEqualRes),
    vsEqualAligned: safeData(vsEqualAlignedRes),
    portfolioStats: safeSingle(portfolioRes),
    symbols: safeData(symbolsRes),
    paperPositions: safeData(paperPositionsRes),
    paperEquity: safeData(paperEquityRes),
    vsEqualSymbol: safeData(vsEqualSymbolRes),
    regimeEdge: safeData(regimeEdgeRes),
    deadlineTiers: safeData(deadlineTiersRes),
    geometryRisk: safeData(geometryRiskRes),
    kairosPivots: safeData(kairosPivotsRes),
    health: null,
    refreshed_at: new Date().toISOString(),
  };
}

export async function GET() {

  const supabase = getClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "This endpoint is not configured on this deployment." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Auth context is cached per Clerk user — avoids re-querying users +
  // subscriptions on every dashboard poll.
  const ctx = await cached(`dashctx:${userId}`, 60_000, async () => {
    // Do NOT call Clerk unless role is unknown (checkRole → clerkClient.getUser
    // is ~1s and was firing for every member on every dashboard load).
    const { data: localUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    let isAdmin = roleFromLocalUser(localUser, "admin");
    if (isAdmin == null) {
      try {
        isAdmin = await checkRole("admin");
      } catch {
        isAdmin = false;
      }
    }

    let planSlug = null;
    let planUuid = null;
    if (localUser?.id) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select(
          `plan_id,
           plans(id, title, description, price_cents, currency, interval,
                 helio_paylink_id, slug)`
        )
        .eq("user_id", localUser.id)
        .in("status", ["pending", "active", "grace"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      planSlug = subscription?.plans?.slug ?? null;
      planUuid = subscription?.plans?.id ?? subscription?.plan_id ?? null;
    }

    return { isAdmin: !!isAdmin, planSlug, planUuid };
  });

  const isAdmin = ctx.isAdmin;
  const planSlug = ctx.planSlug;
  const planUuid = ctx.planUuid;

  if (!isAdmin && !planSlug) {
    return NextResponse.json({
      ...emptyBundle(),
      planSlug: null,
      isPro: false,
      isAdmin: false,
    });
  }

  const isPro = isAdmin || planSlug === "precision_pro";
  // One in-process cache for the heavy bundle. 60s is fine — the DB snapshot
  // itself is refreshed every 2 min by pg_cron.
  const cacheKey = `dash:${isAdmin ? "admin" : planSlug || "none"}:${isPro ? "pro" : "std"}`;

  const bundle = await cached(cacheKey, 60_000, async () => {
    const fromCache = await loadCachedBundle(supabase);
    if (fromCache) return fromCache;
    return loadLiveBundle(supabase);
  });

  const {
    sweeps: sweepsAll,
    signalHealth: healthAll,
    calibration: calAll,
    calibrationBoard: boardAll,
    outcomeBySide: outcomeAll,
    renkoBricks: renkoAll,
    vsEqual,
    vsEqualAligned,
    portfolioStats,
    symbols: symbolsAll,
    paperPositions,
    paperEquity,
    vsEqualSymbol,
    regimeEdge: regimeEdgeAll,
  } = bundle;

  let symbolsData = symbolsAll;
  if (symbolsData.length === 0) {
    const { data: allActive } = await supabase
      .from("v_talaria_symbols")
      .select("*")
      .eq("active", true);
    symbolsData = allActive || [];
  }
  const planSymbolSet = new Set(symbolsData.map((s) => s.symbol));

  const filteredSweeps = sweepsAll.filter((s) => planSymbolSet.has(s.symbol));
  const filteredRenko = renkoAll.filter((b) => planSymbolSet.has(b.symbol));
  // Kelly table is the same rows as latest_signals — no second round-trip.
  const kellyRows = filteredSweeps;

  return NextResponse.json(
    {
      sweeps: filteredSweeps,
      signalHealth: healthAll,
      calibration: calAll,
      calibrationBoard: boardAll.filter((r) => planSymbolSet.has(r.symbol)),
      outcomeBySide: outcomeAll.filter((r) => planSymbolSet.has(r.symbol)),
      vsEqual: isPro ? vsEqual : [],
      vsEqualAligned,
      vsEqualSymbol: isPro ? vsEqualSymbol : [],
      portfolioStats: isPro ? portfolioStats : null,
      renkoBricks: filteredRenko,
      kelly: kellyRows,
      symbols: symbolsData,
      paperPositions: isPro ? paperPositions : [],
      paperEquity: isPro ? paperEquity : [],
      regimeEdge: (regimeEdgeAll || []).filter((r) => planSymbolSet.has(r.symbol)),
      planSlug,
      isPro,
      isAdmin,
    },
    { headers: { "Cache-Control": "private, max-age=15" } }
  );
}
