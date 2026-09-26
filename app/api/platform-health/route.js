// =============================================================================
// Noble Trading App — Next.js API Route: platform-health
// =============================================================================
//   GET /api/platform-health
//   → user-safe quality/ops metrics (portal/dashboard PlatformHealthCard)
//   → admin block only when users.role === 'admin'
//
// Reads v_platform_health_summary (migration 0018) — one pre-aggregated row.
// Does NOT page nt_signal_sim (slow / load-heavy on the trading DB).
// Missing view degrades to null metrics, never a 500.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function round(n, d = 3) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  const p = 10 ** d;
  return Math.round(Number(n) * p) / p;
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

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: localUser } = await supabase
    .from("users")
    .select("id, role")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const isAdmin = localUser?.role === "admin";

  // Single-row aggregate view — no table scans from this process.
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
    sweep_coverage_24h: round(health?.sweep_coverage_24h),
    last_light_slot_at: health?.generated_at ?? null,
    expiry_share_7d: round(health?.expiry_share_7d),
    edge_vs_no_skill_7d: round(health?.edge_vs_no_skill_7d),
    eod_resolver_ok: health ? Boolean(health.eod_resolver_ok) : null,
    improvements: IMPROVEMENTS,
  };

  const adminBlock = isAdmin
    ? {
        decided_7d: health?.decided_7d ?? null,
        tp_rate_7d: round(health?.tp_rate_7d),
        edge_vs_no_skill_7d: round(health?.edge_vs_no_skill_7d),
        expiry_share_7d: round(health?.expiry_share_7d),
        rank_stamp_share_24h: round(health?.rank_stamp_share_24h),
        rows_24h: health?.rows_24h ?? null,
        slots_24h: health?.slots_24h ?? null,
        last_calibration_closed_at: health?.last_calibration_closed_at ?? null,
        roadmap,
        source: "v_platform_health_summary",
        era_note:
          "Pre/post ATR and resolver-fix splits live in backend worklogs; do not pool eras for promote decisions.",
      }
    : undefined;

  return NextResponse.json({
    generated_at: health?.generated_at || new Date().toISOString(),
    user: userBlock,
    ...(adminBlock ? { admin: adminBlock } : {}),
  });
}
