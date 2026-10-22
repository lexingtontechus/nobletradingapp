// =============================================================================
// Noble Trading App — Supabase Edge Function: portfolio-analytics-warm
// =============================================================================
// Refreshes the Portfolio tab's cached analytics (correlation + signal-agreement)
// by calling nobletradingapp-backend and upserting the results into
// v_correlation_cache / v_signal_agreement_cache.
//
// WHY THIS LIVES IN SUPABASE, NOT VERCEL (2026-10-05): the previous design ran
// this as a pg_cron -> Vercel route (nobletrading.app/api/portfolio-analytics/
// warm). That route awaited a ~55s backend call inside a default-budget
// serverless function, so Vercel killed it before the cache write — the caches
// stayed frozen (computed_at stuck). Scheduled compute belongs in Supabase,
// exactly like eod-report-generate / send-renewal-reminders. Vercel is the web
// tier only.
//
// Triggered two ways (see migration 0028 for the pg_cron schedule):
//   1. pg_cron, every 6h — sends `X-Supabase-Cron: true` (this project's
//      convention, matching eod-report-generate / sweep-expired-redis-creds).
//   2. Manually — nobletradingapp's correlation/signal-agreement routes forward
//      a `?refresh=1` with `X-Internal-Secret`.
//
// POST body: { "plan_slug"?: "precision_pro" }  — defaults to precision_pro.
//
// Env vars (Supabase Dashboard -> Edge Functions -> Secrets; copy the same
// values as nobletradingapp's Vercel env):
//   SUPABASE_URL, SUPABASE_SECRET_KEYS   — auto-injected
//   INTERNAL_FUNCTION_SECRET                  — shared secret, manual trigger
//   WEBAPP_BACKEND_API_KEY                    — must match the backend's API_KEY
//   WEBAPP_BACKEND_URL                        — optional; defaults to Render
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Supabase's new secret key env var is a JSON object keyed by key name
const SUPABASE_SECRET_KEYS = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"
);
const SUPABASE_SERVICE_KEY =
  (SUPABASE_SECRET_KEYS.kairos ?? Object.values(SUPABASE_SECRET_KEYS)[0])!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "";
const WEBAPP_BACKEND_URL =
  Deno.env.get("WEBAPP_BACKEND_URL") || "https://nobletradingapp-backend.onrender.com";
const WEBAPP_BACKEND_API_KEY = Deno.env.get("WEBAPP_BACKEND_API_KEY") ?? "";

const LOOKBACK_DAYS = 90;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─── Backend call + cache upsert ────────────────────────────────────────────

async function callBackend(path: string): Promise<{ ok: boolean; payload?: any; error?: string }> {
  if (!WEBAPP_BACKEND_API_KEY) {
    return { ok: false, error: "WEBAPP_BACKEND_API_KEY is not configured." };
  }
  try {
    const res = await fetch(`${WEBAPP_BACKEND_URL}${path}`, {
      headers: { "X-API-Key": WEBAPP_BACKEND_API_KEY, Accept: "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Backend error (${res.status}): ${detail.slice(0, 300)}` };
    }
    return { ok: true, payload: await res.json() };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}

async function computeCorrelation(planSlug: string, symbols: string[]) {
  const joined = [...symbols].sort().join(",");
  const result = await callBackend(
    `/webapp/correlation-overview?symbols=${encodeURIComponent(joined)}`
  );
  if (!result.ok) {
    // No-clobber: annotate the error only, leave any prior good payload intact.
    await supabase
      .from("v_correlation_cache")
      .update({ error: result.error })
      .eq("plan_slug", planSlug);
    return { ok: false, error: result.error };
  }
  const computedAt = new Date().toISOString();
  const { error } = await supabase.from("v_correlation_cache").upsert(
    {
      plan_slug: planSlug,
      computed_at: computedAt,
      symbols: [...symbols].sort(),
      payload: result.payload,
      window_days: result.payload?.n_bars_fitted ?? null,
      error: null,
    },
    { onConflict: "plan_slug" }
  );
  return { ok: !error, computed_at: computedAt, error: error?.message ?? null };
}

async function computeAgreement(planSlug: string, symbols: string[]) {
  const joined = [...symbols].sort().join(",");
  const result = await callBackend(
    `/webapp/signal-agreement?symbols=${encodeURIComponent(joined)}&lookback_days=${LOOKBACK_DAYS}`
  );
  if (!result.ok) {
    await supabase
      .from("v_signal_agreement_cache")
      .update({ error: result.error })
      .eq("plan_slug", planSlug);
    return { ok: false, error: result.error };
  }
  const computedAt = new Date().toISOString();
  const { error } = await supabase.from("v_signal_agreement_cache").upsert(
    {
      plan_slug: planSlug,
      computed_at: computedAt,
      symbols: [...symbols].sort(),
      payload: result.payload,
      lookback_days: LOOKBACK_DAYS,
      error: null,
    },
    { onConflict: "plan_slug" }
  );
  return { ok: !error, computed_at: computedAt, error: error?.message ?? null };
}

// ─── HTTP handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-internal-secret");
  const fromCron = req.headers.get("x-supabase-cron") === "true";
  if (!fromCron && (!INTERNAL_SECRET || secret !== INTERNAL_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let planSlug = "precision_pro";
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.plan_slug) planSlug = body.plan_slug;
  } catch {
    // no body — use default
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("id, slug")
    .eq("slug", planSlug)
    .maybeSingle();
  if (!plan) {
    return Response.json({ ok: false, error: `no plan '${planSlug}'` }, { status: 404 });
  }

  const { data: symRows, error: symErr } = await supabase
    .from("v_talaria_symbols")
    .select("symbol")
    .contains("plan_ids", [plan.id]);
  if (symErr) {
    return Response.json({ ok: false, error: symErr.message }, { status: 500 });
  }
  const symbols = (symRows ?? []).map((r: any) => r.symbol).sort();
  if (symbols.length < 2) {
    return Response.json(
      { ok: false, error: "Not enough symbols in this plan's roster to warm analytics caches." },
      { status: 200 }
    );
  }

  const [correlation, agreement] = await Promise.all([
    computeCorrelation(planSlug, symbols),
    computeAgreement(planSlug, symbols),
  ]);

  return Response.json({
    ok: Boolean(correlation.ok || agreement.ok),
    plan_slug: planSlug,
    symbols,
    warmed_at: new Date().toISOString(),
    correlation,
    agreement,
  });
});
