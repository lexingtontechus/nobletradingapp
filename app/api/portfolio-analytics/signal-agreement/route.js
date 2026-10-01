// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/signal-agreement
// =============================================================================
// Server-side proxy for nobletradingapp-backend GET /webapp/signal-agreement.
// Same stale-first policy as correlation (Vercel ~10s cap vs Render compute):
// return cached payload immediately (even if TTL expired), only compute when
// empty or ?refresh=1, and always respond with JSON.
//
// GET  /api/portfolio-analytics/signal-agreement           — cached / stale-first
// GET  /api/portfolio-analytics/signal-agreement?refresh=1 — try recompute, else stale
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
const ON_DEMAND_COMPUTE_MS = 8_000;
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

  if (planSlug !== "precision_pro") {
    return NextResponse.json(
      { error: "Signal agreement analysis is a Precision Pro feature." },
      { status: 403 }
    );
  }

  const cached = await readAnalyticsCache("v_signal_agreement_cache", planSlug);
  const hasPayload = Boolean(cached?.payload);
  const ageMs = cached?.computed_at
    ? Date.now() - new Date(cached.computed_at).getTime()
    : Infinity;
  const fresh = hasPayload && ageMs < CACHE_TTL_MS;

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
      "Not enough symbols in this plan's roster to compute signal agreement."
    );
  }

  try {
    const computed = await computeAndCacheAgreement(planSlug, symbols, LOOKBACK_DAYS, {
      timeoutMs: ON_DEMAND_COMPUTE_MS,
    });
    if (!computed.ok) {
      return respondWithStaleOrError(
        cached,
        computed.error || computed.write_error || "Signal-agreement recompute failed."
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
  return NextResponse.json(
    {
      error: message,
      warming: true,
      hint: "Analytics cache is empty; the scheduled warm job will fill it shortly.",
    },
    { status: 502 }
  );
}
