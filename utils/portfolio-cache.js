// =============================================================================
// Portfolio analytics cache writes (correlation + signal-agreement)
// =============================================================================
// Both portfolio-analytics routes proxy nobletradingapp-backend and persist the
// result in a 1:1 cache view (v_correlation_cache / v_signal_agreement_cache).
//
// The previous upsert ignored errors, so a failed write left `computed_at`
// frozen (live: correlation stuck at 2026-09-06 → every request recomputed on
// free-tier Render and took ~11s). Writes now:
//   * upsert with explicit onConflict=plan_slug (PostgREST needs this on views)
//   * log the error body
//   * return { ok, error } so callers can surface cache-write failures
// =============================================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export function getSupabase() {
  return supabase;
}

/**
 * Upsert one plan_slug row into a 1:1 cache view.
 * @param {"v_correlation_cache"|"v_signal_agreement_cache"} view
 * @param {{ plan_slug: string, computed_at: string, symbols: string[], payload: object, error?: string|null, window_days?: number|null, lookback_days?: number|null }} row
 */
export async function upsertAnalyticsCache(view, row) {
  const body = {
    plan_slug: row.plan_slug,
    computed_at: row.computed_at,
    symbols: row.symbols,
    payload: row.payload,
    error: row.error ?? null,
  };
  if (view === "v_correlation_cache") {
    body.window_days = row.window_days ?? null;
  } else {
    body.lookback_days = row.lookback_days ?? null;
  }

  const { data, error } = await supabase
    .from(view)
    .upsert(body, { onConflict: "plan_slug" })
    .select("plan_slug, computed_at");

  if (error) {
    console.error(`[portfolio-cache] ${view} upsert failed for ${row.plan_slug}:`, {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    return { ok: false, error: error.message || "upsert_failed" };
  }

  console.log(
    `[portfolio-cache] ${view} upsert ok ${row.plan_slug} computed_at=${row.computed_at}`
  );
  return { ok: true, row: data?.[0] ?? null };
}

export async function readAnalyticsCache(view, planSlug) {
  const { data, error } = await supabase
    .from(view)
    .select("*")
    .eq("plan_slug", planSlug)
    .maybeSingle();
  if (error) {
    console.error(`[portfolio-cache] ${view} read failed for ${planSlug}:`, error.message);
    return null;
  }
  return data ?? null;
}

const WEBAPP_BACKEND_URL =
  process.env.WEBAPP_BACKEND_URL || "https://nobletradingapp-backend.onrender.com";
const WEBAPP_BACKEND_API_KEY = process.env.WEBAPP_BACKEND_API_KEY;
const BACKEND_TIMEOUT_MS = 55_000;

async function callBackend(path) {
  if (!WEBAPP_BACKEND_API_KEY) {
    return { ok: false, error: "WEBAPP_BACKEND_API_KEY is not configured on the server." };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${WEBAPP_BACKEND_URL}${path}`, {
      headers: { "X-API-Key": WEBAPP_BACKEND_API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Backend error (${res.status}): ${detail}` };
    }
    return { ok: true, payload: await res.json() };
  } catch (e) {
    clearTimeout(timeout);
    return {
      ok: false,
      error:
        e?.name === "AbortError"
          ? "Backend timed out (cold start on the free Render tier can take ~50s — try again)."
          : String(e),
    };
  }
}

/** Recompute correlation for a symbol list and write the cache row. */
export async function computeAndCacheCorrelation(planSlug, symbols) {
  const joined = [...symbols].sort().join(",");
  const result = await callBackend(
    `/webapp/correlation-overview?symbols=${encodeURIComponent(joined)}`
  );
  const computedAt = new Date().toISOString();
  const write = await upsertAnalyticsCache("v_correlation_cache", {
    plan_slug: planSlug,
    computed_at: computedAt,
    symbols: [...symbols].sort(),
    payload: result.ok ? result.payload : null,
    window_days: result.ok ? result.payload?.n_bars_fitted ?? null : null,
    error: result.ok ? null : result.error,
  });
  return {
    ok: result.ok && write.ok,
    cached: false,
    computed_at: computedAt,
    write_error: write.ok ? null : write.error,
    ...(result.ok ? result.payload : { error: result.error }),
  };
}

/** Recompute signal-agreement for a symbol list and write the cache row. */
export async function computeAndCacheAgreement(planSlug, symbols, lookbackDays = 90) {
  const joined = [...symbols].sort().join(",");
  const result = await callBackend(
    `/webapp/signal-agreement?symbols=${encodeURIComponent(joined)}&lookback_days=${lookbackDays}`
  );
  const computedAt = new Date().toISOString();
  const write = await upsertAnalyticsCache("v_signal_agreement_cache", {
    plan_slug: planSlug,
    computed_at: computedAt,
    symbols: [...symbols].sort(),
    payload: result.ok ? result.payload : null,
    lookback_days: lookbackDays,
    error: result.ok ? null : result.error,
  });
  return {
    ok: result.ok && write.ok,
    cached: false,
    computed_at: computedAt,
    write_error: write.ok ? null : write.error,
    ...(result.ok ? result.payload : { error: result.error }),
  };
}

/** Plan-gated symbol roster for correlation / agreement. */
export async function planSymbolRoster(planUuid) {
  const { data, error } = await supabase
    .from("v_talaria_symbols")
    .select("symbol")
    .contains("plan_ids", [planUuid]);
  if (error || !data) return [];
  return data.map((r) => r.symbol).sort();
}

/**
 * Warm both caches for one plan (used by cron + ?refresh=1).
 * Falls back to existing rows' symbol list when the live roster is empty.
 */
export async function warmPlanAnalytics(planSlug, planUuid) {
  const roster = await planSymbolRoster(planUuid);
  let symbols = roster;
  if (symbols.length < 2) {
    const cached = await readAnalyticsCache("v_correlation_cache", planSlug);
    symbols = Array.isArray(cached?.symbols) ? cached.symbols : [];
  }
  if (symbols.length < 2) {
    return {
      plan_slug: planSlug,
      ok: false,
      error: "Not enough symbols in this plan's roster to warm analytics caches.",
    };
  }

  const [correlation, agreement] = await Promise.all([
    computeAndCacheCorrelation(planSlug, symbols),
    computeAndCacheAgreement(planSlug, symbols, 90),
  ]);

  return {
    plan_slug: planSlug,
    symbols,
    // Warm succeeds if at least one cache is usable; callers still see
    // per-cache errors (correlation often 422s on a thin daily-close overlap).
    ok: Boolean(correlation.ok || agreement.ok),
    correlation: {
      ok: correlation.ok,
      computed_at: correlation.computed_at,
      write_error: correlation.write_error ?? null,
      error: correlation.error ?? null,
    },
    agreement: {
      ok: agreement.ok,
      computed_at: agreement.computed_at,
      write_error: agreement.write_error ?? null,
      error: agreement.error ?? null,
    },
  };
}
