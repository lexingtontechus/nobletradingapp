-- =============================================================================
-- 0029: extend v_talaria_latest_signals with Kairos geometry + rank fields
-- =============================================================================
-- Adds base_brick_size, brick_vol_scale, vol_ratio (migration 199) and
-- kairos_rank_score, kairos_event_window, kairos_transition (migration 183)
-- to the latest-signals view so the frontend can display the full Kairos
-- signal context without a second query.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_talaria_latest_signals AS
SELECT DISTINCT ON (s.symbol)
  s.symbol,
  s.sweep_timestamp       AS sweep_timestamp,
  s.regime,
  s.id,
  s.regime_conf,
  l.markov_p_up,
  l.markov_p_dn,
  s.p_win,
  s.ev,
  s.p_timesfm,
  s.kelly_f,
  s.effective_kelly,
  s.brick_size,
  s.sl_bricks,
  s.tp_bricks,
  s.signal,
  s.entry_price,
  s.stop_loss,
  s.take_profit,
  s.qualified,
  s.aggression,
  s.regime_shift,
  s.prev_regime,
  s.size_mult,
  -- TA indicators (nullable — best-effort fetch)
  s.ta_adx,
  s.ta_ao,
  s.ta_bb_power,
  s.ta_macd,
  s.ta_rsi,
  -- Kairos geometry fields (migration 199)
  s.base_brick_size,
  s.brick_vol_scale,
  s.vol_ratio,
  -- Kairos rank fields (migration 183)
  s.kairos_rank_score,
  s.kairos_event_window,
  s.kairos_transition
FROM public.nt_sweep_result s
LEFT JOIN LATERAL (
  SELECT rl.markov_p_up, rl.markov_p_dn
  FROM public.nt_regime_log rl
  WHERE rl.symbol = s.symbol
  ORDER BY rl.detected_at DESC
  LIMIT 1
) l ON true
ORDER BY s.symbol, s.sweep_timestamp DESC;

COMMENT ON VIEW public.v_talaria_latest_signals IS
  'Latest sweep result per symbol (one row per symbol, newest first). '
  'Joins nt_sweep_result with the latest nt_regime_log to add markov_p_up/dn. '
  'Includes Kairos geometry fields (base_brick_size, brick_vol_scale, vol_ratio) '
  'and rank fields (kairos_rank_score, kairos_event_window, kairos_transition). '
  'Read by the Talaria plugin + web dashboard via anon key.';

GRANT SELECT ON v_talaria_latest_signals TO anon;
