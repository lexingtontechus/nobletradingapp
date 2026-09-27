-- 0023_dashboard_bundle_cache.sql
-- Collapse the 13-way PostgREST fan-out into one cached JSONB row.
--
-- WHY: dashboard-data was firing 13 concurrent Supabase REST view queries.
-- Under load those stampede the connection pool (observed 6–10s wall, and
-- intermittent 500s on individual views). The views themselves are fine —
-- the fan-out is the bottleneck.
--
-- Design:
--   talaria_dashboard_cache  — single-row table (id=1) holding the full bundle
--   refresh_talaria_dashboard_cache() — rebuilds payload from the same views
--   pg_cron every 2 minutes (CONCURRENTLY on latest_signals matview)
--   Routes read one row; empty cache falls back to live fan-out and seeds.

CREATE TABLE IF NOT EXISTS public.talaria_dashboard_cache (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload      jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- Keep the latest_signals matview fresh without locking readers.
-- Unique index already exists (0022) so CONCURRENTLY is legal.
CREATE OR REPLACE FUNCTION public.refresh_talaria_dashboard_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
BEGIN
  -- Non-blocking matview refresh when possible.
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_talaria_latest_signals;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      REFRESH MATERIALIZED VIEW public.v_talaria_latest_signals;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- keep prior matview contents
    END;
  END;

  _payload := jsonb_build_object(
    'sweeps', (
      SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      FROM public.v_talaria_latest_signals s
    ),
    'signalHealth', (
      SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
      FROM public.v_talaria_signal_health h
    ),
    'calibration', (
      SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      FROM public.v_eod_calibration_bias_latest c
    ),
    'calibrationBoard', (
      SELECT coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
      FROM public.v_calibration_confidence_board b
    ),
    'outcomeBySide', (
      SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
      FROM public.v_signal_outcome_by_side o
      WHERE o.qualified
    ),
    -- Last 10 renko bricks per active symbol (was a 400-row unfiltered dump).
    'renkoBricks', (
      SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      FROM (
        SELECT rb.*
        FROM public.v_talaria_symbols sym
        CROSS JOIN LATERAL (
          SELECT *
          FROM public.v_talaria_renko br
          WHERE br.symbol = sym.symbol
          ORDER BY br.session_date DESC, br.brick_index DESC
          LIMIT 10
        ) rb
      ) r
    ),
    'vsEqual', (
      SELECT coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
      FROM public.v_paper_vs_optimized_daily v
    ),
    'vsEqualAligned', (
      SELECT coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
      FROM public.v_paper_vs_equalwt_aligned v
    ),
    'vsEqualSymbol', (
      SELECT coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
      FROM public.v_paper_vs_optimized_symbol v
    ),
    'portfolioStats', (
      SELECT to_jsonb(p)
      FROM public.v_talaria_portfolio_stats p
      LIMIT 1
    ),
    'symbols', (
      SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
      FROM public.v_talaria_symbols s
      WHERE s.active
    ),
    'paperPositions', (
      SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
      FROM (
        SELECT * FROM public.v_paper_positions ORDER BY open_ts DESC LIMIT 200
      ) p
    ),
    'paperEquity', (
      SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
      FROM public.v_paper_equity e
    ),
    'health', (
      SELECT to_jsonb(h)
      FROM public.v_platform_health_summary h
      LIMIT 1
    )
  );

  INSERT INTO public.talaria_dashboard_cache (id, payload, refreshed_at)
  VALUES (1, _payload, now())
  ON CONFLICT (id) DO UPDATE
    SET payload = EXCLUDED.payload,
        refreshed_at = EXCLUDED.refreshed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_talaria_dashboard_cache() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_talaria_dashboard_cache() TO service_role;

GRANT SELECT ON public.talaria_dashboard_cache TO service_role;
-- No anon grant: routes always use the service-role client.

-- Seed immediately so the first dashboard hit is already warm.
SELECT public.refresh_talaria_dashboard_cache();

-- Refresh every 2 minutes. Idempotent schedule name.
SELECT cron.unschedule('refresh_talaria_dashboard_cache')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'refresh_talaria_dashboard_cache'
);

SELECT cron.schedule(
  'refresh_talaria_dashboard_cache',
  '*/2 * * * *',
  $$SELECT public.refresh_talaria_dashboard_cache()$$
);

COMMENT ON TABLE public.talaria_dashboard_cache IS
  'Single-row JSONB snapshot of the dashboard-data fan-out + platform health. Refreshed by pg_cron every 2 min via refresh_talaria_dashboard_cache().';
COMMENT ON FUNCTION public.refresh_talaria_dashboard_cache() IS
  'Rebuilds talaria_dashboard_cache.payload from the talaria/analytics views. Refreshes v_talaria_latest_signals CONCURRENTLY first.';
