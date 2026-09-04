-- =============================================================================
-- Noble Trading App — Migration 0011: Correlation heatmap view + cache table
-- =============================================================================
-- Supports the Portfolio tab's correlation heatmap (replaces the old paper-vs
-- equal-weight PortfolioView). The FastAPI backend's POST /correlation/detect
-- requires the CALLER to supply a returns_matrix — it has no persisted price
-- history of its own. nt_renko_bricks (owned by noble-trader-fastapi-backend,
-- already anon-readable per migration 108) is the only persisted, timestamped
-- price series we have, so v_talaria_daily_close resamples it into one closing
-- price per (symbol, session_date) that app/api/portfolio-analytics/correlation
-- pivots into a log-returns matrix before calling the backend.
--
-- nt_correlation_cache stores the last computed result per plan so the (slow,
-- free-tier Render) backend call only happens on a TTL, not on every page load.
-- =============================================================================

-- ─── 1. v_talaria_daily_close — one closing price per symbol per session ──────
-- DISTINCT ON (symbol, session_date) picks the last brick of the day (highest
-- brick_index, tie-broken by ts) as that day's close.
CREATE OR REPLACE VIEW public.v_talaria_daily_close AS
SELECT DISTINCT ON (b.symbol, b.session_date)
  b.symbol,
  b.session_date,
  b.close_price,
  b.ts
FROM public.nt_renko_bricks b
ORDER BY b.symbol, b.session_date, b.brick_index DESC, b.ts DESC;

COMMENT ON VIEW public.v_talaria_daily_close IS
  'One closing price per (symbol, session_date), resampled from nt_renko_bricks. '
  'Used to build a synchronized log-returns matrix for POST /correlation/detect and /optimise, '
  'which require the caller to supply returns rather than computing them server-side.';

GRANT SELECT ON public.v_talaria_daily_close TO anon;

-- ─── 2. nt_correlation_cache — per-plan cached backend response ───────────────
-- Server-only (no anon policy): read/written exclusively by
-- app/api/portfolio-analytics/correlation using the service-role key.
CREATE TABLE IF NOT EXISTS public.nt_correlation_cache (
  plan_slug    text PRIMARY KEY,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  window_days  int,
  symbols      jsonb,
  payload      jsonb,
  error        text
);

ALTER TABLE public.nt_correlation_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.nt_correlation_cache;
CREATE POLICY "Service role full access" ON public.nt_correlation_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.nt_correlation_cache IS
  'Cached POST /correlation/detect response per plan_slug. No anon policy — '
  'read/written server-side only via the service-role key.';
