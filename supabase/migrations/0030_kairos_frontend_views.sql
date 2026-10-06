-- =============================================================================
-- 0030: Kairos frontend views — deadline tiers, geometry risk, macro pivots
-- =============================================================================
-- Three new views to surface Kairos-computed fields on the dashboard:
--   v_talaria_deadline_tiers  — per-(symbol, vol_tier) resolution deadlines
--   v_talaria_geometry_risk   — long-lag risk from bracket reachability
--   v_talaria_kairos_pivots   — macro event pivot labels
-- =============================================================================

-- ─── 1. v_talaria_deadline_tiers ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_talaria_deadline_tiers AS
SELECT
  symbol,
  vol_tier,
  soft_deadline_hours,
  hard_deadline_hours,
  median_hours,
  n,
  confidence
FROM public.nt_deadline_tiers;

COMMENT ON VIEW public.v_talaria_deadline_tiers IS
  'Per-(symbol, vol_tier) resolution deadline tiers from dynamic_deadline.py. '
  'Soft = p75 (full credit), Hard = p90 (zero credit), Median = p50 (expected). '
  'Read by the web dashboard via anon key.';

GRANT SELECT ON v_talaria_deadline_tiers TO anon;

-- ─── 2. v_talaria_geometry_risk ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_talaria_geometry_risk AS
SELECT
  symbol,
  vol_tier,
  distance_atr_bucket,
  pct_expired,
  p90_hours,
  n_stored,
  n
FROM public.nt_bracket_reachability
WHERE n_stored >= 3;

COMMENT ON VIEW public.v_talaria_geometry_risk IS
  'Long-lag risk metrics from nt_bracket_reachability. '
  'pct_expired = share of signals that expired without hitting TP/SL. '
  'p90_hours = 90th percentile resolution time. '
  'Read by the web dashboard via anon key.';

GRANT SELECT ON v_talaria_geometry_risk TO anon;

-- ─── 3. v_talaria_kairos_pivots ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_talaria_kairos_pivots AS
SELECT
  symbol,
  pivot_label,
  pivot_axis,
  pivot_intensity,
  pivot_surprise,
  pivot_as_of,
  pivot_event_title,
  pivot_summary
FROM public.nt_macro_forecast
WHERE pivot_label IS NOT NULL;

COMMENT ON VIEW public.v_talaria_kairos_pivots IS
  'Macro event pivot labels from kairos_pivot.py. '
  'pivot_label: major_pivot | incremental | no_change. '
  'pivot_axis: reaction_function | tool | trajectory | none. '
  'Read by the web dashboard via anon key.';

GRANT SELECT ON v_talaria_kairos_pivots TO anon;
