// =============================================================================
// Noble Trading App — Next.js API Route: platform-health
// =============================================================================
//   GET /api/platform-health
//   → user product metrics + admin ops metrics
//
// Reads v_platform_health_summary (one pre-aggregated row). Cached in-process
// for 60s — the view scans nt_signal_sim and must not be hit per page load.
// Missing view degrades to null metrics, never a 500.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { roleFromLocalUser, checkRole } from "@/utils/roles";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const HEALTH_TTL_MS = 60_000;
let healthCache = { at: 0, data: null };

function round(n, d = 3) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const p = 10 ** d;
  return Math.round(Number(n) * p) / p;
}

function delta(cur, prev) {
  const c = Number(cur);
  const p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) {
    return { value: round(cur), prev: round(prev), pct: null };
  }
  return {
    value: round(cur),
    prev: round(prev),
    pct: round((c - p) / Math.abs(p), 4),
  };
}

const IMPROVEMENTS = [
  {
    id: "geometry",
    title: "Smarter exits",
    detail:
      "Take-profit / stop geometry is being tightened so trades resolve in hours instead of expiring with no result.",
  },
  {
    id: "resolver",
    title: "Complete settlement",
    detail:
      "More settled outcomes (including losses) reach the scorecard, so calibration is less biased toward wins.",
  },
  {
    id: "feedback",
    title: "Faster feedback loop",
    detail:
      "Outcome capture is moving from one nightly batch toward hourly, so quality reads stay current.",
  },
  {
    id: "honesty",
    title: "Honest quality metrics",
    detail:
      "We measure edge against each trade's own odds — not a marketing win percentage.",
  },
];

async function loadHealth() {
  const now = Date.now();
  if (healthCache.data && now - healthCache.at < HEALTH_TTL_MS) {
    return healthCache.data;
  }
  let health = null;
  try {
    const { data } = await supabase
      .from("v_platform_health_summary")
      .select("*")
      .maybeSingle();
    health = data || null;
  } catch {
    health = null;
  }
  healthCache = { at: now, data: health };
  return health;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [localRes, health] = await Promise.all([
    supabase.from("users").select("id, role").eq("clerk_user_id", userId).maybeSingle(),
    loadHealth(),
  ]);
  const localUser = localRes?.data;

  // Fast path from users.role; Clerk only when role is unknown.
  let isAdmin = roleFromLocalUser(localUser, "admin");
  if (isAdmin == null) {
    try {
      isAdmin = await checkRole("admin");
    } catch {
      isAdmin = false;
    }
  }

  let roadmap = [];
  if (isAdmin) {
    try {
      const { data: rm } = await supabase
        .from("nt_roadmap")
        .select("mechanism, status, current_state, updated_at")
        .in("status", ["pending", "resolved", "blocked"])
        .order("updated_at", { ascending: false })
        .limit(12);
      roadmap = rm || [];
    } catch {
      roadmap = [];
    }
  }

  const userBlock = {
    signals_24h: health?.qualified_24h ?? null,
    signals_7d: delta(health?.qualified_7d, health?.qualified_7d_prev),
    last_signal_at: health?.last_signal_at ?? null,
    last_scan_at: health?.last_scan_at ?? null,
    symbols_watched: health?.symbols_active ?? null,
    settled_7d: health?.decided_7d ?? null,
    win_rate_7d: delta(health?.tp_rate_7d, health?.tp_rate_7d_prev),
    expired_share_7d: delta(health?.expiry_share_7d, health?.expiry_share_7d_prev),
    edge_vs_odds_7d: delta(health?.edge_vs_no_skill_7d, health?.edge_vs_no_skill_7d_prev),
    improvements: IMPROVEMENTS,
  };

  const adminBlock = isAdmin
    ? {
        sweep_coverage_24h: round(health?.sweep_coverage_24h),
        eod_resolver_ok: health ? Boolean(health.eod_resolver_ok) : null,
        rank_stamp_share_24h: round(health?.rank_stamp_share_24h),
        rows_24h: health?.rows_24h ?? null,
        slots_24h: health?.slots_24h ?? null,
        last_calibration_closed_at: health?.last_calibration_closed_at ?? null,
        decided_7d: health?.decided_7d ?? null,
        tp_rate_7d: round(health?.tp_rate_7d),
        expiry_share_7d: round(health?.expiry_share_7d),
        edge_vs_no_skill_7d: round(health?.edge_vs_no_skill_7d),
        roadmap,
        source: "v_platform_health_summary",
        era_note:
          "Pre/post ATR and resolver-fix splits live in backend worklogs; do not pool eras for promote decisions.",
      }
    : undefined;

  return NextResponse.json(
    {
      generated_at: health?.generated_at || new Date().toISOString(),
      user: userBlock,
      ...(adminBlock ? { admin: adminBlock } : {}),
    },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
