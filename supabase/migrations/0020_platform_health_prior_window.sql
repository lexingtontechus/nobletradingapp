-- 0020_platform_health_prior_window.sql
-- Prior-7d window for period-over-period deltas on the dashboard StatCards.
-- Drops and recreates v_platform_health_summary (column list grew).

DROP VIEW IF EXISTS public.v_platform_health_summary;

CREATE VIEW public.v_platform_health_summary AS
WITH light24 AS (
  SELECT
    to_char(
      date_trunc('minute', ts) - (extract(minute from ts)::int % 15) * interval '1 minute',
      'YYYY-MM-DD HH24:MI'
    ) AS slot,
    kairos_rank_score,
    qualified
  FROM public.nt_signal_sim
  WHERE source = 'sweep-light'
    AND signal IN ('buy', 'sell')
    AND ts >= now() - interval '24 hours'
),
slots24 AS (
  SELECT
    count(DISTINCT slot)::numeric AS slot_count,
    count(*)::numeric AS row_count,
    count(kairos_rank_score)::numeric AS rank_count,
    count(*) FILTER (WHERE qualified)::numeric AS qualified_24h,
    max(slot) AS last_slot
  FROM light24
),
decided_window AS (
  SELECT
    CASE
      WHEN ts >= now() - interval '7 days' THEN 'cur'
      WHEN ts >= now() - interval '14 days' THEN 'prev'
    END AS win,
    outcome,
    qualified,
    ts,
    CASE
      WHEN coalesce(tp_distance_atr, tp_bricks) > 0
       AND coalesce(sl_distance_atr, sl_bricks) > 0
      THEN coalesce(sl_distance_atr, sl_bricks)
           / (coalesce(tp_distance_atr, tp_bricks) + coalesce(sl_distance_atr, sl_bricks))
      ELSE NULL
    END AS no_skill,
    CASE WHEN outcome = 'tp_hit' THEN 1.0 WHEN outcome = 'sl_hit' THEN 0.0 ELSE NULL END AS hit
  FROM public.nt_signal_sim
  WHERE source = 'sweep-light'
    AND signal IN ('buy', 'sell')
    AND ts >= now() - interval '14 days'
),
agg AS (
  SELECT
    win,
    count(*) FILTER (WHERE outcome IN ('tp_hit', 'sl_hit'))::numeric AS decided,
    count(*) FILTER (WHERE outcome = 'tp_hit')::numeric AS tp,
    count(*)::numeric AS closed,
    count(*) FILTER (WHERE outcome = 'expired')::numeric AS expired,
    count(*) FILTER (WHERE qualified)::numeric AS qualified,
    avg(hit - no_skill) FILTER (WHERE hit IS NOT NULL AND no_skill IS NOT NULL) AS edge_vs_no_skill,
    avg(hit) FILTER (WHERE hit IS NOT NULL) AS tp_rate,
    -- QUALIFIED only — same population as broadcast + FloatingSignalsWidget.
    -- max(ts) over all rows made Realtime look "live" while the widget was empty.
    max(ts) FILTER (WHERE qualified) AS last_signal_at,
    max(ts) FILTER (WHERE win = 'cur') AS last_scan_at
  FROM decided_window
  WHERE win IS NOT NULL
  GROUP BY win
),
cur AS (SELECT * FROM agg WHERE win = 'cur'),
prev AS (SELECT * FROM agg WHERE win = 'prev'),
cal AS (
  SELECT max(closed_at) AS last_closed_at
  FROM public.nt_calibration_records
  WHERE closed_at IS NOT NULL
),
sym AS (
  SELECT count(*)::numeric AS symbols_active
  FROM public.v_talaria_symbols
  WHERE active
)
SELECT
  now() AS generated_at,
  least(1.0, coalesce(slots24.slot_count / 96.0, 0)) AS sweep_coverage_24h,
  slots24.row_count AS rows_24h,
  slots24.slot_count AS slots_24h,
  slots24.qualified_24h AS qualified_24h,
  slots24.last_slot AS last_slot_24h,
  CASE WHEN slots24.row_count > 0
       THEN slots24.rank_count / slots24.row_count ELSE NULL
  END AS rank_stamp_share_24h,
  cur.decided AS decided_7d,
  cur.qualified AS qualified_7d,
  cur.tp_rate AS tp_rate_7d,
  CASE WHEN cur.closed > 0 THEN cur.expired / cur.closed ELSE NULL END AS expiry_share_7d,
  cur.edge_vs_no_skill AS edge_vs_no_skill_7d,
  cur.last_signal_at AS last_signal_at,
  cur.last_scan_at AS last_scan_at,
  prev.qualified AS qualified_7d_prev,
  prev.tp_rate AS tp_rate_7d_prev,
  CASE WHEN prev.closed > 0 THEN prev.expired / prev.closed ELSE NULL END AS expiry_share_7d_prev,
  prev.edge_vs_no_skill AS edge_vs_no_skill_7d_prev,
  cal.last_closed_at AS last_calibration_closed_at,
  (cal.last_closed_at IS NOT NULL
   AND cal.last_closed_at >= now() - interval '36 hours') AS eod_resolver_ok,
  sym.symbols_active
FROM slots24
LEFT JOIN cur ON true
LEFT JOIN prev ON true
CROSS JOIN cal
CROSS JOIN sym;

COMMENT ON VIEW public.v_platform_health_summary IS
  'One-row platform health with prior-7d window for deltas. Ops: coverage, settlement. Users: signals, W/L, vs odds.';

GRANT SELECT ON public.v_platform_health_summary TO anon, service_role;
