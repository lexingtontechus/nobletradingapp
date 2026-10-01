// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/correlation
// =============================================================================
// Server-side proxy for nobletradingapp-backend GET /webapp/correlation-overview
// (X-API-Key via utils/portfolio-cache.callWebappBackend).
//
// Vercel Hobby functions hard-stop at ~10s. Free-tier Render compute often
// takes longer than that, so this route NEVER blocks the request on a
// backend call:
//   * any cached payload is returned immediately (even past the 12h TTL),
//     marked `stale` when expired
//   * `?refresh=1` kicks a background recompute and returns the CURRENT
//     cached payload (marked `refreshing: true`) immediately — it does NOT
//     await the recompute inline. (2026-10-01 incident: the old code
//     awaited computeAndCacheCorrelation inline on ?refresh=1 regardless of
//     whether a cached payload existed; the combined Supabase reads +
//     8s-budgeted backend call routinely exceeded Vercel's hard 10s kill,
//     producing FUNCTION_INVOCATION_TIMEOUT 504s instead of ever reaching
//     the AbortController's own 8s guard.)
//   * only a true cache miss (no row at all) also falls back to a
//     "warming" placeholder when there's nothing to serve yet
//   * cron `/api/portfolio-analytics/warm` (55s budget) is the reliable
//     fill path for a cold cache
//
// GET  /api/portfolio-analytics/correlation           — cached / stale-first
// GET  /api/portfolio-analytics/correlation?refresh=1 — background recompute, serve cache now
// =============================================================================

import { NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  computeAndCacheCorrelation,
  getSupabase,
  planSymbolRoster,
  readAnalyticsCache,
} from "@/utils/portfolio-cache";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

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

  if (planSlug !== "precision_pro") {
    return NextResponse.json(
      { error: "Correlation analysis is a Precision Pro feature." },
      { status: 403 }
    );
  }

  const cached = await readAnalyticsCache("v_correlation_cache", planSlug);
  const hasPayload = Boolean(cached?.payload);
  const ageMs = cached?.computed_at
    ? Date.now() - new Date(cached.computed_at).getTime()
    : Infinity;
  const fresh = hasPayload && ageMs < CACHE_TTL_MS;

  // Serve cache immediately when it's fresh and no refresh was requested —
  // the common, fast path.
  if (hasPayload && !forceRefresh) {
    return NextResponse.json({
      ...cached.payload,
      computed_at: cached.computed_at,
      cached: true,
      stale: !fresh,
    });
  }

  const symbols = await planSymbolRoster(planUuid);
  if (symbols.length < 2) {
    return respondWithStaleOrError(
      cached,
      "Not enough symbols in this plan's roster to compute correlation."
    );
  }

  // Cache miss OR explicit refresh: never await the recompute inline —
  // Vercel Hobby kills the function at ~10s and the Supabase reads above
  // already eat into that budget. Kick a best-effort recompute in the
  // background (55s budget, same as cron) and respond immediately: with
  // the existing cached payload (marked `refreshing`) when we have one,
  // or a "warming" placeholder when we don't.
  startBackgroundWarm(planSlug, symbols);

  if (hasPayload) {
    return NextResponse.json({
      ...cached.payload,
      computed_at: cached.computed_at,
      cached: true,
      stale: !fresh,
      refreshing: true,
    });
  }

  return NextResponse.json({
    error: "Portfolio analytics are warming up.",
    warming: true,
    hint: "This fills automatically in the background. Refresh in a minute.",
  });
}

function startBackgroundWarm(planSlug, symbols) {
  after(() =>
    computeAndCacheCorrelation(planSlug, symbols, { timeoutMs: 55_000 })
      .then((r) => {
        console.log(`[portfolio-cache] background correlation warm`, {
          ok: r?.ok,
          planSlug,
          error: r?.error ?? null,
        });
      })
      .catch((e) => {
        console.warn(`[portfolio-cache] background correlation warm failed`, String(e));
      })
  );
}

function respondWithStaleOrError(cached, message) {
  if (cached?.payload) {
    return NextResponse.json({
      ...cached.payload,
      computed_at: cached.computed_at,
      cached: true,
      stale: true,
      error: message,
    });
  }
  return NextResponse.json(
    {
      error: "Portfolio analytics are warming up.",
      warming: true,
      detail: message,
      hint: "This fills automatically in the background. Refresh in a minute.",
    },
    { status: 200 }
  );
}

