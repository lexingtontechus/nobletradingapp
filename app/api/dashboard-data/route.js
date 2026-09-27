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
//       kelly: [...],               — v_talaria_kelly_by_symbol (Analysis Kelly table)
//       symbols: [...],             — v_talaria_symbols (plan-gated; admin = all active)
//       paperPositions: [...],      — v_paper_positions (Precision Pro only)
//       paperEquity: [...],         — v_paper_equity (Precision Pro only)
//       planSlug, isPro, isAdmin
//     }
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function safeData(res) {
  if (res?.data) return res.data;
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

  if (!isAdmin && !planSlug) {
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
      isAdmin: false,
    });
  }

  const isPro = isAdmin || planSlug === "precision_pro";
  const cacheKey = `dash:${isAdmin ? "admin" : planSlug || "none"}:${isPro ? "pro" : "std"}`;

  // One in-process cache for the heavy parallel fan-out (PostgREST is 0.5–2s
  // per view even when warm — dashboard used to take 8–10s).
  const bundle = await cached(cacheKey, 20_000, async () => {
    let symbolsQuery = supabase
      .from("v_talaria_symbols")
      .select("*")
      .eq("active", true);
    if (!isAdmin && planUuid) {
      symbolsQuery = symbolsQuery.filter("plan_ids", "cs", `{${planUuid}}`);
    }

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
      isPro ? supabase.from("v_paper_positions").select("*") : { data: [] },
      isPro ? supabase.from("v_paper_equity").select("*") : { data: [] },
      isPro ? supabase.from("v_paper_vs_optimized_symbol").select("*") : { data: [] },
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
    };
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
      planSlug,
      isPro,
      isAdmin,
    },
    { headers: { "Cache-Control": "private, max-age=15" } }
  );
}
