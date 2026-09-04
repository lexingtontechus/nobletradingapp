// =============================================================================
// Noble Trading App — Next.js API Route: portfolio-analytics/correlation
// =============================================================================
// Server-side proxy for nobletradingapp-backend's GET /webapp/correlation-overview
// (https://github.com/lexingtontechus/nobletradingapp-backend). That service
// now owns the returns-matrix building + correlation-regime math + the
// Talaria-native reframe (regime alignment, Kelly-weighted concentration) —
// this route just resolves the caller's plan-gated symbol roster, proxies
// the call with X-API-Key auth (WEBAPP_BACKEND_API_KEY, server-only — never
// sent to the browser), and caches the response in v_correlation_cache (a
// 1:1 view over nt_correlation_cache — see migration 0012) for CACHE_TTL_MS,
// since the backend runs on a free-tier Render dyno (cold starts, and this
// is a "cached, not on-demand" feature by design — see
// docs/worklog-backend-capability-exposure.md).
//
// Previously this route built the returns matrix itself and called
// noble-trader-fastapi-backend's generic /correlation/detect directly — see
// git history if that fallback is ever needed again.
//
// GET  /api/portfolio-analytics/correlation           — cached-or-computed
// GET  /api/portfolio-analytics/correlation?refresh=1 — force recompute
// =============================================================================

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const WEBAPP_BACKEND_URL =
  process.env.WEBAPP_BACKEND_URL || "https://nobletradingapp-backend.onrender.com";
const WEBAPP_BACKEND_API_KEY = process.env.WEBAPP_BACKEND_API_KEY;

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — matches the "cached, not on-demand" decision
const BACKEND_TIMEOUT_MS = 55_000; // free-tier Render dyno cold starts can take ~50s

export async function GET(request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    // Compute-heavy analytics are gated the same way as portfolioStats/vsEqual.
    return NextResponse.json(
      { error: "Correlation analysis is a Precision Pro feature." },
      { status: 403 }
    );
  }

  if (!forceRefresh) {
    const { data: cached } = await supabase
      .from("v_correlation_cache")
      .select("*")
      .eq("plan_slug", planSlug)
      .maybeSingle();
    if (cached?.payload && Date.now() - new Date(cached.computed_at).getTime() < CACHE_TTL_MS) {
      return NextResponse.json({ ...cached.payload, computed_at: cached.computed_at, cached: true });
    }
  }

  const { data: roster, error: rosterErr } = await supabase
    .from("v_talaria_symbols")
    .select("symbol")
    .contains("plan_ids", [planUuid]);
  if (rosterErr || !roster || roster.length < 2) {
    return await respondWithStaleOrError(
      planSlug,
      "Not enough symbols in this plan's roster to compute correlation."
    );
  }
  const symbols = roster.map((r) => r.symbol).sort();

  if (!WEBAPP_BACKEND_API_KEY) {
    return await respondWithStaleOrError(
      planSlug,
      "WEBAPP_BACKEND_API_KEY is not configured on the server."
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    const res = await fetch(
      `${WEBAPP_BACKEND_URL}/webapp/correlation-overview?symbols=${encodeURIComponent(symbols.join(","))}`,
      { headers: { "X-API-Key": WEBAPP_BACKEND_API_KEY }, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return await respondWithStaleOrError(planSlug, `Backend error (${res.status}): ${detail}`);
    }

    const payload = await res.json();
    const computedAt = new Date().toISOString();

    await supabase.from("v_correlation_cache").upsert({
      plan_slug: planSlug,
      computed_at: computedAt,
      window_days: payload.n_bars_fitted ?? null,
      symbols,
      payload,
      error: null,
    });

    return NextResponse.json({ ...payload, computed_at: computedAt, cached: false });
  } catch (e) {
    return await respondWithStaleOrError(
      planSlug,
      e.name === "AbortError" ? "Backend timed out (cold start on the free Render tier can take ~50s — try again)." : String(e)
    );
  }
}

// Falls back to the last good cached payload (marked stale) when a fresh
// compute isn't possible, rather than showing nothing.
async function respondWithStaleOrError(planSlug, message) {
  const { data: cached } = await supabase
    .from("v_correlation_cache")
    .select("*")
    .eq("plan_slug", planSlug)
    .maybeSingle();
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
