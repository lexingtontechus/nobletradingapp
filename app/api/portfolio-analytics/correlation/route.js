// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/correlation
// =============================================================================
// Server-side proxy for nobletradingapp-backend GET /webapp/correlation-overview
// (X-API-Key via utils/portfolio-cache.callWebappBackend).
//
// Vercel Hobby functions hard-stop at ~10s. Free-tier Render compute often
// takes longer than that, so this route is STALE-FIRST:
//   * any cached payload is returned immediately (even past the 12h TTL),
//     marked `stale` when expired — cron `/api/portfolio-analytics/warm`
//     refreshes the row
//   * compute only when there is no cache row, or `?refresh=1`, and then
//     with a short budget so we always return JSON before Vercel kills us
//
// GET  /api/portfolio-analytics/correlation           — cached / stale-first
// GET  /api/portfolio-analytics/correlation?refresh=1 — try recompute, else stale
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  computeAndCacheCorrelation,
  getSupabase,
  planSymbolRoster,
  readAnalyticsCache,
} from "@/utils/portfolio-cache";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ON_DEMAND_COMPUTE_MS = 8_000;

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

  // Stale-first: never block a page load on Render compute.
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

  try {
    const computed = await computeAndCacheCorrelation(planSlug, symbols, {
      timeoutMs: ON_DEMAND_COMPUTE_MS,
    });
    if (!computed.ok) {
      return respondWithStaleOrError(
        cached,
        computed.error || computed.write_error || "Correlation recompute failed."
      );
    }
    return NextResponse.json({ ...computed, cached: false, stale: false });
  } catch (e) {
    return respondWithStaleOrError(cached, String(e));
  }
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
  // Always JSON — the dashboard panel must never see an HTML/text crash page.
  return NextResponse.json(
    {
      error: message,
      warming: true,
      hint: "Analytics cache is empty; the scheduled warm job will fill it shortly.",
    },
    { status: 502 }
  );
}
