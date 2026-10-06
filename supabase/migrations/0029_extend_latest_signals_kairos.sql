-- =============================================================================
-- 0029: extend v_talaria_latest_signals with Kairos geometry + rank fields
-- =============================================================================
-- Adds base_brick_size, brick_vol_scale, vol_ratio (migration 199) and
-- kairos_event_window, kairos_transition to the latest-signals view.
-- kairos_rank_score comes from nt_signal_sim (migration 183), not nt_sweep_result.
--
-- v_talaria_latest_signals is a MATERIALIZED VIEW (migration 183), so we
-- CREATE OR REPLACE it with the same structure plus the new columns.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_talaria_latest_signals AS
SELECT
  sym.symbol,
  l.sweep_timestamp,
  l.regime,
  l.id,
  l.regime_conf,
  m.markov_p_up,
  m.markov_p_dn,
  l.p_win,
  l.ev,
  l.p_timesfm,
  l.kelly_f,
  l.effective_kelly,
  l.brick_size,
  l.sl_bricks,
  l.tp_bricks,
  l.signal,
  l.entry_price,
  l.stop_loss,
  l.take_profit,
  l.qualified,
  l.aggression,
  l.regime_shift,
  l.prev_regime,
  l.size_mult,
  l.ta_adx,
  l.ta_ao,
  l.ta_bb_power,
  l.ta_macd,
  l.ta_rsi,
  -- Kairos geometry fields (migration 199)
  l.base_brick_size,
  l.brick_vol_scale,
  l.vol_ratio,
  -- Kairos rank fields (migration 183 — only these exist on nt_signal_sim)
  sim.kairos_rank_score,
  sim.kairos_rank_gate_shadow
FROM public.v_talaria_symbols sym
CROSS JOIN LATERAL (
  SELECT
    s.sweep_timestamp, s.regime, s.id, s.regime_conf, s.p_win, s.ev,
    s.p_timesfm, s.kelly_f, s.effective_kelly, s.brick_size, s.sl_bricks,
    s.tp_bricks, s.signal, s.entry_price, s.stop_loss, s.take_profit,
    s.qualified, s.aggression, s.regime_shift, s.prev_regime, s.size_mult,
    s.ta_adx, s.ta_ao, s.ta_bb_power, s.ta_macd, s.ta_rsi,
    s.base_brick_size, s.brick_vol_scale, s.vol_ratio
  FROM public.nt_sweep_result s
  WHERE s.symbol = sym.symbol
  ORDER BY s.sweep_timestamp DESC
  LIMIT 1
) l
LEFT JOIN LATERAL (
  SELECT rl.markov_p_up, rl.markov_p_dn
  FROM public.nt_regime_log rl
  WHERE rl.symbol = sym.symbol
  ORDER BY rl.detected_at DESC
  LIMIT 1
) m ON true
LEFT JOIN LATERAL (
  SELECT ns.kairos_rank_score, ns.kairos_rank_gate_shadow
  FROM public.nt_signal_sim ns
  WHERE ns.symbol = sym.symbol
    AND ns.kairos_rank_score IS NOT NULL
  ORDER BY ns.ts DESC
  LIMIT 1
) sim ON true;

COMMENT ON VIEW public.v_talaria_latest_signals IS
  'Latest sweep result per active symbol + Kairos rank stamp (183) + geometry fields (199). '
  'Refreshed by refresh_talaria_dashboard_cache() via pg_cron.';

GRANT SELECT ON v_talaria_latest_signals TO anon, service_role;
