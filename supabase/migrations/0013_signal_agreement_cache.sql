-- =============================================================================
-- Noble Trading App — Migration 0013: signal-agreement cache view + table
-- =============================================================================
-- Supports app/api/portfolio-analytics/signal-agreement, which proxies
-- nobletradingapp-backend's GET /webapp/signal-agreement (reframe #2 —
-- concurrent-qualified-signal direction agreement). Mirrors migrations
-- 0011/0012's nt_correlation_cache/v_correlation_cache pattern exactly: a
-- plain table for storage, a 1:1 view for app code to read/write through
-- (never the raw table directly), server-only (no anon/authenticated grant).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nt_signal_agreement_cache (
  plan_slug    text PRIMARY KEY,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  lookback_days int,
  symbols      jsonb,
  payload      jsonb,
  error        text
);

ALTER TABLE public.nt_signal_agreement_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.nt_signal_agreement_cache;
CREATE POLICY "Service role full access" ON public.nt_signal_agreement_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.nt_signal_agreement_cache IS
  'Cached GET /webapp/signal-agreement response per plan_slug. No anon policy — '
  'read/written server-side only via the service-role key, through v_signal_agreement_cache.';

CREATE OR REPLACE VIEW public.v_signal_agreement_cache AS
SELECT plan_slug, computed_at, lookback_days, symbols, payload, error
FROM public.nt_signal_agreement_cache;

COMMENT ON VIEW public.v_signal_agreement_cache IS
  '1:1 wrapper over nt_signal_agreement_cache — app code reads/writes this view, never the raw table.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.v_signal_agreement_cache TO service_role;
