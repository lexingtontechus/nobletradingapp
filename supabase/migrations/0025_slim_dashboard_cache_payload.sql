-- 0025_slim_dashboard_cache_payload.sql
-- Slim the dashboard bundle: vsEqualSymbol (507 rows / ~98KB) and
-- paperPositions (200 / ~52KB) dominated the JSONB and made every
-- dashboard-data read transfer ~240KB.

CREATE OR REPLACE FUNCTION public.refresh_talaria_dashboard_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _payload jsonb;
BEGIN
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_talaria_latest_signals;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      REFRESH MATERIALIZED VIEW public.v_talaria_latest_signals;
    EXCEPTION WHEN OTHERS THEN
      NULL;
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
          LIMIT 8
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
    -- Per-symbol audit. The view groups by (symbol, realized_pnl) and can
    -- emit many rows per symbol — keep one row per symbol for the UI table.
    'vsEqualSymbol', (
      SELECT coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON (symbol) *
        FROM public.v_paper_vs_optimized_symbol
        ORDER BY symbol
      ) v
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
    -- Open book first, then a short closed tail for the UI table.
    'paperPositions', (
      SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
      FROM (
        SELECT * FROM public.v_paper_positions
        ORDER BY (status = 'open') DESC, open_ts DESC
        LIMIT 80
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

SELECT public.refresh_talaria_dashboard_cache();
