// =============================================================================
// Noble Trading App — Next.js API Route: platform-health
// =============================================================================
//   GET /api/platform-health
//   → user-safe quality/ops metrics for the portal PlatformHealthCard
//   → admin block (scorecard-lite + roadmap) only when role === 'admin'
//
// Read-only. Service role stays server-side. Missing columns/views degrade
// to null/[] so a partial Studio deploy never 500s the portal.
//
// Metrics mirror noble-trader-fastapi-backend scorecard language:
//   edge_vs_no_skill = mean(1{TP} − SL/(TP+SL)) on decided signals
//   Never a raw "win rate" as a product claim.
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function isIsoRecent(s, maxAgeH) {
  if (!s) return false;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < maxAgeH * 3600 * 1000;
}

function round(n, d = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/** no-skill line SL/(TP+SL) from brick or ATR distances. */
function noSkill(tp, sl) {
  const a = Number(tp);
  const b = Number(sl);
  if (!(a > 0) || !(b > 0)) return null;
  return b / (a + b);
}

async function fetchLightWindow(fromIso) {
  const rows = [];
  const page = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("nt_signal_sim")
      .select(
        "ts,symbol,outcome,qualified,gate_outcome,kairos_rank_score,tp_distance_atr,sl_distance_atr,tp_bricks,sl_bricks"
      )
      .eq("source", "sweep-light")
      .in("signal", ["buy", "sell"])
      .gte("ts", fromIso)
      .order("ts", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) break;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < page) break;
    offset += page;
    if (offset > 20000) break;
  }
  return rows;
}

function summarizeWindow(rows) {
  const slots = new Set();
  let decided = 0;
  let tp = 0;
  let expired = 0;
  let closed = 0;
  let edgeSum = 0;
  let edgeN = 0;
  let rankStamped = 0;

  for (const r of rows) {
    if (r.ts) slots.add(String(r.ts).slice(0, 16));
    if (r.kairos_rank_score !== null && r.kairos_rank_score !== undefined) rankStamped += 1;
    const outcome = r.outcome;
    if (outcome === "tp_hit" || outcome === "sl_hit" || outcome === "expired") closed += 1;
    if (outcome === "expired") expired += 1;
    if (outcome === "tp_hit" || outcome === "sl_hit") {
      decided += 1;
      if (outcome === "tp_hit") tp += 1;
      const ns = noSkill(r.tp_distance_atr ?? r.tp_bricks, r.sl_distance_atr ?? r.sl_bricks);
      if (ns !== null) {
        edgeSum += (outcome === "tp_hit" ? 1 : 0) - ns;
        edgeN += 1;
      }
    }
  }

  // expected 15-min slots in 24h = 96; use distinct minutes buckets if short window
  const coverage =
    slots.size > 0 ? Math.min(1, slots.size / 96) : null;

  return {
    slots: slots.size,
    rows: rows.length,
    sweep_coverage_24h: round(coverage, 3),
    decided,
    tp_rate: decided ? round(tp / decided, 3) : null,
    expiry_share: closed ? round(expired / closed, 3) : null,
    edge_vs_no_skill: edgeN ? round(edgeSum / edgeN, 3) : null,
    rank_stamp_share: rows.length ? round(rankStamped / rows.length, 3) : null,
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

  // 24h window for coverage; 7d for outcome quality (decisions mature slowly)
  const from24 = isoHoursAgo(24);
  const from7d = isoHoursAgo(24 * 7);

  let rows24 = [];
  let rows7 = [];
  let roadmap = [];
  let calOpen = null;
  let lastCalClosed = null;

  try {
    rows24 = await fetchLightWindow(from24);
    // reuse 24h rows + fetch 7d outcomes only when needed
    rows7 = await fetchLightWindow(from7d);
  } catch {
    rows24 = [];
    rows7 = [];
  }

  const sum24 = summarizeWindow(rows24);
  const sum7 = summarizeWindow(rows7);

  try {
    const { data: cal } = await supabase
      .from("nt_calibration_records")
      .select("closed_at, entered_at")
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(20);
    lastCalClosed = cal?.[0]?.closed_at ?? null;
    calOpen = isIsoRecent(lastCalClosed, 36);
  } catch {
    calOpen = null;
  }

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
    sweep_coverage_24h: sum24.sweep_coverage_24h,
    last_light_slot_at: rows24.length
      ? rows24[rows24.length - 1]?.ts ?? null
      : null,
    expiry_share_7d: sum7.expiry_share,
    edge_vs_no_skill_7d: sum7.edge_vs_no_skill,
    eod_resolver_ok: calOpen,
    improvements: IMPROVEMENTS,
  };

  const adminBlock = isAdmin
    ? {
        decided_7d: sum7.decided,
        tp_rate_7d: sum7.tp_rate,
        no_skill_note: "edge_vs_no_skill is the publishable quality number",
        edge_vs_no_skill_7d: sum7.edge_vs_no_skill,
        expiry_share_7d: sum7.expiry_share,
        rank_stamp_share_24h: sum24.rank_stamp_share,
        rows_24h: sum24.rows,
        slots_24h: sum24.slots,
        last_calibration_closed_at: lastCalClosed,
        roadmap,
        era_note:
          "Pre/post ATR and resolver-fix splits live in backend worklogs; do not pool eras for promote decisions.",
      }
    : undefined;

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    user: userBlock,
    ...(adminBlock ? { admin: adminBlock } : {}),
  });
}
