-- 0022_materialize_latest_signals.sql
-- nt_sweep_result has 177k+ rows; DISTINCT ON in a plain view is still slow
-- (~2s). Materialize and refresh from the backend / a cron. Dashboard reads
-- the matview (fast) instead of re-scanning the table.

DROP VIEW IF EXISTS public.v_talaria_kelly_by_symbol CASCADE;
DROP VIEW IF EXISTS public.v_talaria_latest_signals CASCADE;

CREATE MATERIALIZED VIEW public.v_talaria_latest_signals AS
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_talaria_latest_signals_symbol
  ON public.v_talaria_latest_signals (symbol);

CREATE VIEW public.v_talaria_kelly_by_symbol AS
SELECT
  symbol, sweep_timestamp, signal, qualified, effective_kelly, kelly_f, regime,
  aggression, ev, p_win, markov_p_up, entry_price, stop_loss, take_profit,
  brick_size, sl_bricks, tp_bricks
FROM public.v_talaria_latest_signals;

GRANT SELECT ON public.v_talaria_latest_signals TO anon, service_role;
GRANT SELECT ON public.v_talaria_kelly_by_symbol TO anon, service_role;

REFRESH MATERIALIZED VIEW public.v_talaria_latest_signals;
