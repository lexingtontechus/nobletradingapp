-- 0021_optimize_talaria_views.sql
-- v_talaria_latest_signals was ~10s (DISTINCT ON full nt_sweep_result + LATERAL
-- per row). Rewrite: latest-per-symbol CTE first, then a single markov join.
-- Supporting index for (symbol, sweep_timestamp DESC).

CREATE INDEX IF NOT EXISTS idx_nt_sweep_result_symbol_ts
  ON public.nt_sweep_result (symbol, sweep_timestamp DESC);

DROP VIEW IF EXISTS public.v_talaria_latest_signals;

CREATE VIEW public.v_talaria_latest_signals AS
WITH latest AS (
  SELECT DISTINCT ON (s.symbol)
    s.symbol,
    s.sweep_timestamp,
    s.regime,
    s.id,
    s.regime_conf,
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
    s.ta_adx,
    s.ta_ao,
    s.ta_bb_power,
    s.ta_macd,
    s.ta_rsi
  FROM public.nt_sweep_result s
  ORDER BY s.symbol, s.sweep_timestamp DESC
),
markov AS (
  SELECT DISTINCT ON (rl.symbol)
    rl.symbol,
    rl.markov_p_up,
    rl.markov_p_dn
  FROM public.nt_regime_log rl
  ORDER BY rl.symbol, rl.detected_at DESC
)
SELECT
  l.symbol,
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
  l.ta_rsi
FROM latest l
LEFT JOIN markov m ON m.symbol = l.symbol;

COMMENT ON VIEW public.v_talaria_latest_signals IS
  'Latest sweep per symbol. Optimized 2026-09-27: latest CTE + markov join '
  '(was DISTINCT ON + LATERAL per row, ~10s).';

GRANT SELECT ON public.v_talaria_latest_signals TO anon, service_role;
