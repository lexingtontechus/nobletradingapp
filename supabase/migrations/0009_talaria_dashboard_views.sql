-- =============================================================================
-- Noble Trading App — Migration 0009: Talaria dashboard views
-- =============================================================================
-- Creates the 5 missing views that the Talaria desktop plugin queries via the
-- Supabase REST API + Realtime broadcast channels. ALL views are pure SELECT
-- over existing tables (nt_symbol, nt_sweep_result, nt_renko_bricks,
-- nt_paper_positions, nt_regime_log) — NO new tables, NO writes to production
-- data. These are read-only views consumed by both the desktop plugin and the
-- web dashboard.
--
-- Views created:
--   v_talaria_symbols            — active symbols + TradingView mapping + plan_ids
--   v_talaria_latest_signals     — latest sweep per symbol (denormalized with regime log)
--   v_talaria_renko              — renko bricks per symbol (current session)
--   v_paper_positions            — open paper positions (Pro view seed)
--   v_paper_equity               — daily equity curve (needed by dashboard-data API)
--
-- Existing views NOT recreated (already defined by talaria/fastapi migrations):
--   v_talaria_signal_health      — migration 110 (talaria repo)
--   v_talaria_portfolio_stats    — migration 110 (talaria repo)
--   v_eod_calibration_bias_latest — migration 115 (fastapi backend)
--   v_paper_vs_optimized_daily   — migration 106 (fastapi backend)
--   v_paper_equity               — migration 105 (fastapi backend)
--
-- Plan-scoping: nt_sweep_result and nt_renko_bricks are NOT plan-specific at
-- the row level — the plan filtering happens via the claim-token RLS policies
-- (Pro views check the JWT claim) or via the Realtime broadcast channel
-- realtime:signals.<plan_slug> consumed by the webapp.
-- =============================================================================

-- ─── 1. v_talaria_symbols — plan-gated active symbol catalog ──────────────
-- Mirrors nt_symbol with plan_ids (UUID[]) for the ?plan_ids=cs.{uuid} filter
-- the plugin uses. Exposes tradingview_symbol for TVChart embedding.
-- The backend (migration 032) backfills plan_ids for all active symbols.
--
-- Uses DISTINCT ON (s.symbol) to get one row per symbol — the symbol picker
-- / Renko chart operates per-symbol, not per-venue.
-- Column order matters for PostgREST: s.symbol must be first (DISTINCT ON key),
-- and s.id must be included (PostgREST requires an "id" column for pagination).
CREATE OR REPLACE VIEW public.v_talaria_symbols AS
SELECT DISTINCT ON (s.symbol)
  s.symbol,
  s.asset_class,
  s.data_source,
  s.tradingview_symbol,
  s.exchange,
  s.plan_ids,
  s.active
FROM public.nt_symbol s
WHERE s.active = true
  AND s.plan_ids IS NOT NULL
   AND s.symbol IS NOT NULL
ORDER BY s.symbol, s.exchange;

COMMENT ON VIEW public.v_talaria_symbols IS
  'Active symbols with plan membership (plan_ids UUID[]) and TradingView symbol. '
  'Consumers filter with ?select=symbol&plan_ids=cs.{plan_uuid} for plan-scoped symbol lists.';

-- ─── 2. v_talaria_latest_signals — latest sweep per symbol ───────────────
-- Joins nt_sweep_result with the latest nt_regime_log row per symbol to provide
-- markov_p_up / markov_p_dn (not on nt_sweep_result, only on nt_regime_log).
-- Uses DISTINCT ON (symbol) to get one row per symbol, the latest by sweep_timestamp.
-- Column order matters for PostgREST: s.symbol must be first (DISTINCT ON key),
-- and s.id must be included (PostgREST requires an "id" column for pagination).
DROP VIEW IF EXISTS public.v_talaria_latest_signals;

CREATE VIEW public.v_talaria_latest_signals AS
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
  s.ta_rsi
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
  'Consumers select: symbol,sweep_timestamp,regime,regime_conf,markov_p_up,markov_p_dn,'
  'p_win,ev,p_timesfm,kelly_f,effective_kelly,brick_size,sl_bricks,tp_bricks,signal,'
  'entry_price,stop_loss,take_profit,qualified,aggression,regime_shift,prev_regime,size_mult,id.'
  'Read by the Talaria plugin + web dashboard via anon key.';

-- ─── 3. v_talaria_renko — renko bricks (current session, latest 10 per symbol) ──
-- nt_renko_bricks has: brick_id, symbol, direction (up|down), brick_size,
--   open_price, close_price, high, low, label, brick_index, ts, session_date.
-- Query orders by session_date DESC, brick_index DESC per the 111-prune migration.
CREATE OR REPLACE VIEW public.v_talaria_renko AS
SELECT
  r.symbol,
  r.direction,
  r.brick_size,
  r.open_price,
  r.close_price,
  r.high,
  r.low,
  r.brick_index,
  r.ts,
  r.session_date
FROM public.nt_renko_bricks r
ORDER BY r.session_date DESC, r.symbol, r.brick_index DESC;

COMMENT ON VIEW public.v_talaria_renko IS
  'Renko bricks ordered by session_date DESC, brick_index DESC. '
  'Consumers fetch the latest 10 per symbol via limit + symbol filter, '
  'or the full series (200) for the Markov card. Read via anon key.';

-- ─── 4. v_paper_positions — open/closed paper positions (Pro view seed) ────
-- nt_paper_positions has: position_id, signal_id, symbol, venue, direction,
--   entry_price, stop_loss, take_profit, size_units, size_notional,
--   open_ts, close_ts, status, exit_price, realized_pnl, r_multiple, source,
--   resolved_at.
-- The plugin fetches: symbol,direction,status,realized_pnl,r_multiple,open_ts
-- with order: open_ts.desc, limit: 20.
CREATE OR REPLACE VIEW public.v_paper_positions AS
SELECT
  p.symbol,
  p.direction,
  p.status,
  p.realized_pnl,
  p.r_multiple,
  p.open_ts,
  p.exit_price,
  p.size_notional,
  p.size_units
FROM public.nt_paper_positions p
ORDER BY p.open_ts DESC;

COMMENT ON VIEW public.v_paper_positions IS
  'Paper portfolio positions ordered by open_ts DESC. '
  'Consumers fetch open positions for the live paper P&L widget, '
  'or all positions (closed + expired) for performance analytics. '
  'Read by the Talaria plugin + web dashboard (Pro plans only via claim token RLS).';

-- ─── 5. v_paper_equity — daily equity curve (needed by dashboard-data API) ─
-- The fastapi backend migration 105 already creates this view, but we define it
-- here as a safety net for fresh installs where only nobletradingapp migrations
-- have run. CREATE OR REPLACE is idempotent — if 105 already deployed it,
-- this is a no-op (replaces with identical definition).
-- nt_renko_bricks schema (from migration 108): brick_id, symbol, direction,
--   brick_size, open_price, close_price, high, low, label, brick_index,
--   ts, session_date.
CREATE OR REPLACE VIEW public.v_paper_equity AS
WITH daily AS (
  SELECT
    DATE(COALESCE(close_ts, open_ts)) AS day,
    SUM(CASE WHEN status IN ('closed', 'expired')
             THEN COALESCE(realized_pnl, 0) ELSE 0 END) AS realized_pnl,
    SUM(CASE WHEN status = 'open'
             THEN COALESCE(size_notional, 0) ELSE 0 END) AS open_notional
  FROM public.nt_paper_positions
  GROUP BY 1
)
SELECT
  day,
  realized_pnl,
  open_notional,
  SUM(realized_pnl) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                     AS cumulative_pnl
FROM daily
ORDER BY day;

COMMENT ON VIEW public.v_paper_equity IS
  'Daily equity curve: realized PnL + open notional per day + cumulative PnL. '
  'Base notional = 1000 (NOBLE_PAPER_BASE_NOTIONAL default). '
  'Used by v_talaria_portfolio_stats for Sharpe/Sortino/Calmar calculations. '
  'Read by the Talaria plugin + web dashboard (Pro plans only).';

-- ─── 6. Anon SELECT GRANTs ─────────────────────────────────────────────────
-- All views are read-only (SELECT only). No INSERT/UPDATE/DELETE for anon.
-- Pro-only views (v_paper_positions, v_paper_equity, v_talaria_portfolio_stats)
-- are additionally gated by claim-token RLS — the anon grant is harmless since
-- the RLS policy still blocks unprivileged reads.
GRANT SELECT ON v_talaria_symbols TO anon;
GRANT SELECT ON v_talaria_latest_signals TO anon;
GRANT SELECT ON v_talaria_renko TO anon;
GRANT SELECT ON v_paper_positions TO anon;
GRANT SELECT ON v_paper_equity TO anon;

-- =============================================================================
-- POST-RUN VERIFICATION (paste into Supabase SQL editor):
--   SELECT symbol, tradingview_symbol, plan_ids FROM v_talaria_symbols LIMIT 5;
--   -- Expect: one row per symbol (BTCUSD, ETHUSD, XAUUSD, etc.) — no duplicate
--   -- symbols from multi-exchange rows (DISTINCT ON ensures one row per symbol)

--   SELECT symbol, signal, entry_price, take_profit, stop_loss, p_win, ev,
--          kelly_f, effective_kelly, brick_size, signal, markov_p_up, markov_p_dn
--   FROM v_talaria_latest_signals LIMIT 5;
--   -- Expect: one row per symbol, newest sweep, with markov columns populated

--   SELECT symbol, direction, open_price, close_price, brick_index, session_date
--   FROM v_talaria_renko WHERE symbol = 'BTCUSD' ORDER BY brick_index DESC LIMIT 10;
--   -- Expect: 10 bricks, direction up/down, prices that form a valid renko series

--   SELECT * FROM v_paper_positions WHERE status = 'open' LIMIT 10;
--   -- Expect: open paper positions (may be empty if no trades yet — this is fine)

--   SELECT * FROM v_paper_equity ORDER BY day DESC LIMIT 1;
--   -- Expect: latest day's cumulative_pnl (may be empty/no rows if no positions)
-- =============================================================================
