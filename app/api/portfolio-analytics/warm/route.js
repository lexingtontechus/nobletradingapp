// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/warm
// =============================================================================
// Cron / internal warm for the correlation + signal-agreement caches so the
// first Precision Pro visitor does not pay free-tier Render cold-start + compute
// (~8–12s). Reuses utils/portfolio-cache.js.
//
// Auth (either):
//   X-Supabase-Cron: true          — pg_cron → net.http_post
//   X-Internal-Secret: <secret>    — INTERNAL_FUNCTION_SECRET
//
// GET/POST /api/portfolio-analytics/warm
//   optional body/query: { "plan_slug": "precision_pro" }  (default: all Pro)
//
// → 200 { ok: true, plans: [ { plan_slug, correlation, agreement, ... } ] }
// =============================================================================

import { NextResponse } from "next/server";
import {
  getSupabase,
  warmPlanAnalytics,
} from "@/utils/portfolio-cache";

function authorized(request) {
  const cron = request.headers.get("x-supabase-cron") === "true";
  const secret = request.headers.get("x-internal-secret");
  const expected = process.env.INTERNAL_FUNCTION_SECRET;
  if (cron) return true;
  if (expected && secret && secret === expected) return true;
  return false;
}

async function handle(request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let planFilter = null;
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    planFilter = body?.plan_slug ?? body?.planSlug ?? null;
  }
  if (!planFilter) {
    planFilter = new URL(request.url).searchParams.get("plan_slug");
  }

  const supabase = getSupabase();

  // Plans that actually get these analytics (Precision Pro today).
  const { data: plans, error: planErr } = await supabase
    .from("plans")
    .select("id, slug, title")
    .eq("slug", planFilter || "precision_pro")
    .order("slug");

  if (planErr || !plans?.length) {
    return NextResponse.json(
      { ok: false, error: planErr?.message || "no matching plans" },
      { status: 404 }
    );
  }

  const results = [];
  for (const plan of plans) {
    try {
      results.push(await warmPlanAnalytics(plan.slug, plan.id));
    } catch (e) {
      results.push({ plan_slug: plan.slug, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    warmed_at: new Date().toISOString(),
    plans: results,
  });
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
