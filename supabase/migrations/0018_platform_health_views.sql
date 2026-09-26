-- 0018_platform_health_views.sql
-- Pre-aggregated platform health + Kelly-by-symbol views.
-- Replaces large nt_signal_sim scans in /api/platform-health (slow, load-heavy).
-- Views only — no tables. Service-role + anon SELECT.

-- ─── 1. v_platform_health_summary — one row of ops/quality metrics ─────────
-- Windows:
--   coverage 24h: distinct 15-min buckets with ≥1 light-sweep row / 96
--   outcomes 7d: closed light rows (TP/SL/expired) for expiry + edge vs no-skill
--   rank stamps 24h: share of light rows with kairos_rank_score
--   settlement: latest nt_calibration_records.closed_at within 36h

CREATE OR REPLACE VIEW public.v_platform_health_summary AS
WITH light24 AS (
  SELECT
    to_char(date_trunc('minute', ts) - (extract(minute from ts)::int % 15) * interval '1 minute', 'YYYY-MM-DD HH24:MI') AS slot,
    kairos_rank_score
  FROM public.nt_signal_sim
  WHERE source = 'sweep-light'
    AND signal IN ('buy', 'sell')
    AND ts >= now() - interval '24 hours'
),
slots24 AS (
  SELECT count(DISTINCT slot)::numeric AS slot_count,
         count(*)::numeric AS row_count,
         count(kairos_rank_score)::numeric AS rank_count
  FROM light24
),
decided7 AS (
  SELECT
    outcome,
    CASE
      WHEN coalesce(tp_distance_atr, tp_bricks) > 0 AND coalesce(sl_distance_atr, sl_bricks) > 0
      THEN (coalesce(sl_distance_atr, sl_bricks))
           / (coalesce(tp_distance_atr, tp_bricks) + coalesce(sl_distance_atr, sl_bricks))
      ELSE NULL
    END AS no_skill,
    CASE WHEN outcome = 'tp_hit' THEN 1.0 WHEN outcome = 'sl_hit' THEN 0.0 ELSE NULL END AS hit
  FROM public.nt_signal_sim
  WHERE source = 'sweep-light'
    AND signal IN ('buy', 'sell')
    AND outcome IN ('tp_hit', 'sl_hit', 'expired')
    AND ts >= now() - interval '7 days'
),
agg7 AS (
  SELECT
    count(*) FILTER (WHERE outcome IN ('tp_hit', 'sl_hit'))::numeric AS decided,
    count(*) FILTER (WHERE outcome = 'tp_hit')::numeric AS tp,
    count(*)::numeric AS closed,
    count(*) FILTER (WHERE outcome = 'expired')::numeric AS expired,
    avg(hit - no_skill) FILTER (WHERE hit IS NOT NULL AND no_skill IS NOT NULL) AS edge_vs_no_skill,
    avg(hit) FILTER (WHERE hit IS NOT NULL) AS tp_rate
  FROM decided7
),
cal AS (
  SELECT max(closed_at) AS last_closed_at
  FROM public.nt_calibration_records
  WHERE closed_at IS NOT NULL
)
SELECT
  now() AS generated_at,
  least(1.0, coalesce(slots24.slot_count / 96.0, 0)) AS sweep_coverage_24h,
  slots24.row_count AS rows_24h,
  slots24.slot_count AS slots_24h,
  CASE WHEN slots24.row_count > 0 THEN slots24.rank_count / slots24.row_count ELSE NULL END AS rank_stamp_share_24h,
  agg7.decided AS decided_7d,
  agg7.tp_rate AS tp_rate_7d,
  CASE WHEN agg7.closed > 0 THEN agg7.expired / agg7.closed ELSE NULL END AS expiry_share_7d,
  agg7.edge_vs_no_skill AS edge_vs_no_skill_7d,
  cal.last_closed_at AS last_calibration_closed_at,
  (cal.last_closed_at IS NOT NULL AND cal.last_closed_at >= now() - interval '36 hours') AS eod_resolver_ok
FROM slots24, agg7, cal;

COMMENT ON VIEW public.v_platform_health_summary IS
  'One-row platform health for /api/platform-health. Avoids paging nt_signal_sim from the app.';

GRANT SELECT ON public.v_platform_health_summary TO anon, service_role;

-- ─── 2. v_talaria_kelly_by_symbol — Analysis tab Kelly table source ────────
-- Thin wrapper over v_talaria_latest_signals so the UI has a stable contract
-- even if the sweep view is redefined later.

CREATE OR REPLACE VIEW public.v_talaria_kelly_by_symbol AS
SELECT
  symbol,
  sweep_timestamp,
  signal,
  qualified,
  effective_kelly,
  kelly_f,
  regime,
  aggression,
  ev,
  p_win,
  markov_p_up,
  entry_price,
  stop_loss,
  take_profit,
  brick_size,
  sl_bricks,
  tp_bricks
FROM public.v_talaria_latest_signals;

COMMENT ON VIEW public.v_talaria_kelly_by_symbol IS
  'Kelly-by-symbol rows for the dashboard Analysis tab (stable column contract).';

GRANT SELECT ON public.v_talaria_kelly_by_symbol TO anon, service_role;
