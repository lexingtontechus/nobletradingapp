// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/signal-agreement
// =============================================================================
// Server-side proxy for nobletradingapp-backend's GET /webapp/signal-agreement
// (concurrent-qualified-signal direction agreement across symbol pairs).
// Same shape as the correlation route: plan-gated roster, X-API-Key proxy,
// cache in v_signal_agreement_cache (12h TTL). Writes via utils/portfolio-cache
// (explicit onConflict + error logging). Cron warm:
// GET /api/portfolio-analytics/warm.
//
// GET  /api/portfolio-analytics/signal-agreement           — cached-or-computed
// GET  /api/portfolio-analytics/signal-agreement?refresh=1 — force recompute
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  computeAndCacheAgreement,
  getSupabase,
  planSymbolRoster,
  readAnalyticsCache,
} from "@/utils/portfolio-cache";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 90;

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
      { error: "Signal agreement analysis is a Precision Pro feature." },
      { status: 403 }
    );
  }

  if (!forceRefresh) {
    const cached = await readAnalyticsCache("v_signal_agreement_cache", planSlug);
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
      "Not enough symbols in this plan's roster to compute signal agreement."
    );
  }

  try {
    const computed = await computeAndCacheAgreement(planSlug, symbols, LOOKBACK_DAYS);
    if (!computed.ok) {
      return await respondWithStaleOrError(
        planSlug,
        computed.error || computed.write_error || "Signal-agreement recompute failed."
      );
    }
    return NextResponse.json({ ...computed, cached: false });
  } catch (e) {
    return await respondWithStaleOrError(planSlug, String(e));
  }
}

async function respondWithStaleOrError(planSlug, message) {
  const cached = await readAnalyticsCache("v_signal_agreement_cache", planSlug);
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
