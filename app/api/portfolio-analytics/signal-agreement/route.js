// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/signal-agreement
// =============================================================================
// READ-ONLY cache server for nobletradingapp-backend's GET /webapp/signal-agreement.
// This route NEVER computes — the refresh is a Supabase Edge Function
// (supabase/functions/portfolio-analytics-warm, scheduled by migration 0028).
// Vercel is the web tier only; scheduled compute lives in Supabase.
//
// GET  /api/portfolio-analytics/signal-agreement           — serve cached payload
// GET  /api/portfolio-analytics/signal-agreement?refresh=1 — kick the edge-fn refresh, serve cache
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase, readAnalyticsCache } from "@/utils/portfolio-cache";
import { roleFromLocalUser, checkRole } from "@/utils/roles";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

// Best-effort kick of the Supabase edge-function refresh. Short client timeout:
// the edge function keeps running server-side after Vercel stops waiting, so the
// compute completes and writes the cache regardless.
async function kickEdgeRefresh(planSlug) {
  const secret = process.env.INTERNAL_FUNCTION_SECRET;
  if (!secret) return;
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/portfolio-analytics-warm`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": secret },
      body: JSON.stringify({ plan_slug: planSlug }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // timeout/abort is expected — the edge function continues server-side
  }
}

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Portfolio analytics is not configured on this deployment." },
      { status: 503 }
    );
  }
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";

  const { data: localUser } = await supabase
    .from("users")
    .select("id, role")
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

  const planSlug = subscription?.plans?.slug ?? null;

  // Open access: any current subscriber (any plan) may view the matrices.
  // A user with no active subscription is allowed only if they are an admin --
  // who reads the precision_pro cache, mirroring the dashboard page's
  // admin->precision_pro fallback. Admin is the top of the gate, not a tier.
  if (!planSlug) {
    let isAdmin = roleFromLocalUser(localUser, "admin");
    if (isAdmin == null) {
      isAdmin = await checkRole("admin");
    }
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 403 }
      );
    }
  }

  const cachePlanSlug = planSlug || "precision_pro";

  if (forceRefresh) {
    await kickEdgeRefresh(cachePlanSlug);
  }

  const cached = await readAnalyticsCache("v_signal_agreement_cache", cachePlanSlug);
  const hasPayload = Boolean(cached?.payload);
  const ageMs = cached?.computed_at
    ? Date.now() - new Date(cached.computed_at).getTime()
    : Infinity;
  const fresh = hasPayload && ageMs < CACHE_TTL_MS;

  if (hasPayload) {
    return NextResponse.json({
      ...cached.payload,
      computed_at: cached.computed_at,
      cached: true,
      stale: !fresh,
      ...(forceRefresh ? { refreshing: true } : {}),
    });
  }

  return NextResponse.json({
    error: "Portfolio analytics are warming up.",
    warming: true,
    hint: "This fills automatically in the background. Refresh in a minute.",
  });
}

