// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/correlation
// =============================================================================
// Server-side proxy for nobletradingapp-backend's GET /webapp/correlation-overview
// (https://github.com/lexingtontechus/nobletradingapp-backend). That service
// owns the returns-matrix building + correlation-regime math + the Talaria
// reframe. This route resolves the plan-gated roster, proxies with X-API-Key,
// and caches the response in v_correlation_cache (12h TTL).
//
// Cache writes go through utils/portfolio-cache.js (explicit onConflict +
// error logging). Cron warm: GET /api/portfolio-analytics/warm.
//
// GET  /api/portfolio-analytics/correlation           — cached-or-computed
// GET  /api/portfolio-analytics/correlation?refresh=1 — force recompute
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  computeAndCacheCorrelation,
  getSupabase,
  planSymbolRoster,
  readAnalyticsCache,
} from "@/utils/portfolio-cache";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — "cached, not on-demand"

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";

  const { data: localUser } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (!localUser) {
    return NextResponse.json({ error: "No plan found" }, { status: 403 });
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(`plan_id, plans(id, slug)`)
    .eq("user_id", localUser.id)
    .in("status", ["pending", "active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const planSlug = subscription?.plans?.slug;
  const planUuid = subscription?.plans?.id;
  const isPro = planSlug === "precision_pro";

  if (!isPro) {
    return NextResponse.json(
      { error: "Correlation analysis is a Precision Pro feature." },
      { status: 403 }
    );
  }

  if (!forceRefresh) {
    const cached = await readAnalyticsCache("v_correlation_cache", planSlug);
    if (
      cached?.payload &&
      Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS
    ) {
      return NextResponse.json({
        ...cached.payload,
        computed_at: cached.computed_at,
        cached: true,
      });
    }
  }

  const symbols = await planSymbolRoster(planUuid);
  if (symbols.length < 2) {
    return await respondWithStaleOrError(
      planSlug,
      "Not enough symbols in this plan's roster to compute correlation."
    );
  }

  try {
    const computed = await computeAndCacheCorrelation(planSlug, symbols);
    if (!computed.ok) {
      return await respondWithStaleOrError(
        planSlug,
        computed.error || computed.write_error || "Correlation recompute failed."
      );
    }
    return NextResponse.json({ ...computed, cached: false });
  } catch (e) {
    return await respondWithStaleOrError(planSlug, String(e));
  }
}

// Falls back to the last good cached payload (marked stale) when a fresh
// compute isn't possible, rather than showing nothing.
async function respondWithStaleOrError(planSlug, message) {
  const cached = await readAnalyticsCache("v_correlation_cache", planSlug);
  if (cached?.payload) {
    return NextResponse.json({
      ...cached.payload,
      computed_at: cached.computed_at,
      cached: true,
      stale: true,
      error: message,
    });
  }
  return NextResponse.json({ error: message }, { status: 502 });
}
