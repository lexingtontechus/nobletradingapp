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

let supabase = null;

/**
 * Built lazily. A module-scope client crashed `next build` during page-data
 * collection whenever the server key was absent — a local `.env.local`
 * carries SUPABASE_SECRET_KEY (the old service-role env name is deprecated
 * and is NOT read here; there is no fallback), and Supabase
 * throws "supabaseKey is required" at import time. Same guard the API routes
 * use: absent config becomes a null client the caller checks, not a crash.
 */
function getClient() {
  if (supabase) return supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error(
      "[portfolio-cache] Missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY"
    );
    return null;
  }
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

export function getSupabase() {
  return getClient();
}

/** Read the cached analytics row for a plan from its 1:1 cache view. */
export async function readAnalyticsCache(view, planSlug) {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client
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

// The compute path moved to the Supabase Edge Function `portfolio-analytics-warm`
// (supabase/functions/portfolio-analytics-warm, scheduled by migration 0028).
// Vercel is read-only over the cache views — it no longer calls the backend or
// writes the caches.
