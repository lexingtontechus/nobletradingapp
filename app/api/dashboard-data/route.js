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
//       renkoBricks: [...],         — webapp /webapp/renko (fallback v_talaria_renko)
//       kelly: [...],               — v_talaria_kelly_by_symbol (Analysis Kelly table)
//       symbols: [...],             — v_talaria_symbols (plan-gated)
//       paperPositions: [...],      — v_paper_positions (Precision Pro only)
//       paperEquity: [...],          — v_paper_equity (Precision Pro only)
//       planSlug, isPro
//     }
//
// Uses the service role key (server-only) so it can read views for ALL
// symbols. Plan-scoping is handled via the claim-token RLS on Pro-only views,
// the Realtime broadcast channel realtime:signals.<plan_slug>, and the
// v_talaria_symbols.plan_ids containment filter.
//
// Views are created by migration 0009_talaria_dashboard_views.sql (views only,
// no new tables). If a view hasn't been deployed yet, the query returns an
// error (PGRST205) — we degrade gracefully to empty arrays so the dashboard
// renders with its fallback UI instead of crashing.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const WEBAPP_BACKEND_URL =
  process.env.WEBAPP_BACKEND_URL || "https://nobletradingapp-backend.onrender.com";
const WEBAPP_BACKEND_API_KEY = process.env.WEBAPP_BACKEND_API_KEY;

// Helper: safely extract data from a Supabase query result, degrading to []
// when the view doesn't exist (PGRST205) or returns an error.
function safeData(res) {
  if (res?.data) return res.data;
  // PGRST205 = "Could not find the entity relationship..." (view/table doesn't exist)
  // PGRST116 = "The response should be a single object..." (maybeSingle mismatch)
  // Both are expected during gradual rollouts where views are deployed
  // independently of the app code.
  return [];
}

function safeSingle(res) {
  if (res?.data) return res.data;
  return null;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Resolve the user's local ID + active plan
  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!localUser) {
    // First-visit — upsert happens in /api/subscription-status. Return empty.
    return NextResponse.json({
      sweeps: [],
      signalHealth: [],
      calibration: [],
      calibrationBoard: [],
      outcomeBySide: [],
      vsEqual: [],
      vsEqualAligned: [],
      portfolioStats: null,
      renkoBricks: [],
      kelly: [],
      symbols: [],
      paperPositions: [],
      paperEquity: [],
      planSlug: null,
      isPro: false,
    });
  }

  // Most recent active/grace/pending subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(`
      plan_id,
      plans(id, title, description, price_cents, currency, interval,
            helio_paylink_id, slug)
    `)
    .eq("user_id", localUser.id)
    .in("status", ["pending", "active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription?.plans?.slug) {
    return NextResponse.json({
      sweeps: [],
      signalHealth: [],
      calibration: [],
      calibrationBoard: [],
      outcomeBySide: [],
      vsEqual: [],
      vsEqualAligned: [],
      vsEqualSymbol: [],
      portfolioStats: null,
      renkoBricks: [],
      kelly: [],
      symbols: [],
      paperPositions: [],
      paperEquity: [],
      planSlug: null,
      isPro: false,
    });
  }

  const planSlug = subscription.plans.slug;
  const planUuid = subscription.plans.id;
  const isPro = planSlug === "precision_pro";

  // Fetch all dashboard data in parallel.
  // Views are plan-agnostic (anon-readable); plan scoping:
  //   - v_talaria_symbols: filtered by plan_ids contains [planUuid]
  //   - Pro-only views: gated client-side via isPro flag
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
  ] = await Promise.all([
    supabase.from("v_talaria_latest_signals").select("*"),
    supabase.from("v_talaria_signal_health").select("*"),
    supabase.from("v_eod_calibration_bias_latest").select("*"),
    supabase.from("v_calibration_confidence_board").select("*"),
    supabase.from("v_signal_outcome_by_side").select("*").eq("qualified", true),
    supabase.from("v_talaria_renko").select("*").order("session_date", { ascending: false }).order("brick_index", { ascending: false }),
    supabase.from("v_paper_vs_optimized_daily").select("*"),
    supabase.from("v_paper_vs_equalwt_aligned").select("*"),
    supabase.from("v_talaria_portfolio_stats").select("").maybeSingle(),
    // v_talaria_symbols is filtered by plan_ids containment — this is the
    // canonical plan-gated roster (10 symbols for Signal Scout, 20 for Pro).
    // All other views are plan-agnostic, so we filter them client-side here
    // by intersecting against the symbol list from v_talaria_symbols.
    supabase.from("v_talaria_symbols").select("*").contains("plan_ids", [planUuid]),
    isPro ? supabase.from("v_paper_positions").select("*") : { data: [] },
 isPro ? supabase.from("v_paper_equity").select("*") : { data: [] },
 isPro ? supabase.from("v_paper_vs_optimized_symbol").select("*") : { data: [] },
 ]);

  // Plan-gating: v_talaria_symbols returns the plan-scoped roster (10 for
  // Signal Scout, 20 for Precision Pro). Filter sweeps + renko to only include
  // symbols in that roster — otherwise a Signal Scout user would see sweeps for
  // all 39 symbols (including Pro-only symbols).
  // Fallback: if the plan UUID no longer matches plan_ids (view/plan drift),
  // do not wipe the dashboard — use all active symbols from the view.
  let symbolsData = safeData(symbolsRes);
  if (symbolsData.length === 0) {
    const { data: allSyms } = await supabase
      .from("v_talaria_symbols")
      .select("*")
      .eq("active", true);
    symbolsData = allSyms || [];
  }
  const planSymbolSet = new Set(symbolsData.map((s) => s.symbol));

  // Kelly table (Analysis) — dedicated view, not merged sweeps.
  const kellyRes = await supabase.from("v_talaria_kelly_by_symbol").select("*");
  let kellyRows = safeData(kellyRes).filter((r) => planSymbolSet.has(r.symbol));
  if (kellyRows.length === 0) {
    kellyRows = safeData(sweepsRes).filter((s) => planSymbolSet.has(s.symbol));
  }

  // Market renko — prefer webapp backend construction; fall back to the view.
  let renkoRows = safeData(renkoRes).filter((b) => planSymbolSet.has(b.symbol));
  if (planSymbolSet.size > 0 && WEBAPP_BACKEND_API_KEY) {
    try {
      const symList = [...planSymbolSet].slice(0, 30).join(",");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20_000);
      const rr = await fetch(
        `${WEBAPP_BACKEND_URL}/webapp/renko?symbols=${encodeURIComponent(symList)}&limit=10`,
        {
          headers: { "X-API-Key": WEBAPP_BACKEND_API_KEY },
          signal: ctrl.signal,
        }
      );
      clearTimeout(t);
      if (rr.ok) {
        const j = await rr.json();
        if (Array.isArray(j?.bricks) && j.bricks.length) {
          renkoRows = j.bricks.filter((b) => planSymbolSet.has(b.symbol));
        }
      }
    } catch {
      // keep Supabase view fallback
    }
  }

  const filteredSweeps = safeData(sweepsRes).filter((s) => planSymbolSet.has(s.symbol));
  const filteredRenko = renkoRows;

  return NextResponse.json({
    sweeps: filteredSweeps,
    signalHealth: safeData(healthRes),
    calibration: safeData(calibrationRes),
    calibrationBoard: safeData(calibrationBoardRes).filter((r) => planSymbolSet.has(r.symbol)),
    outcomeBySide: safeData(outcomeBySideRes).filter((r) => planSymbolSet.has(r.symbol)),
    vsEqual: isPro ? safeData(vsEqualRes) : [],
    vsEqualAligned: safeData(vsEqualAlignedRes),
    vsEqualSymbol: isPro ? safeData(vsEqualSymbolRes) : [],
    portfolioStats: isPro ? safeSingle(portfolioRes) : null,
    renkoBricks: filteredRenko,
    kelly: kellyRows,
    symbols: symbolsData,
    paperPositions: isPro ? safeData(paperPositionsRes) : [],
    paperEquity: isPro ? safeData(paperEquityRes) : [],
    planSlug,
    isPro,
  });
}
