-- =============================================================================
-- Noble Trading App — Migration 0015: fixed-basket daily P&L view
-- =============================================================================
-- Implements docs/worklog-fixed-basket-portfolio-view.md's resolved sizing
-- convention: risk a fixed $10 per qualified signal (units = $10 / |entry -
-- stop_loss|, so every signal's SL-hit loses ~$10 regardless of symbol/brick
-- size, and every win scales by that signal's actual reward:risk ratio).
-- This is the "vs market performance" benchmark for the EOD report
-- (docs/worklog-eod-signal-accuracy-report.md §3.3): what would cumulative
-- P&L look like if every qualified signal were traded at a fixed risk unit,
-- aggregated across the whole symbol universe.
--
-- NOTE on display framing (found via live data during implementation): the
-- original worklog suggested framing this as "$1,000 -> $1,000 + cumulative"
-- for a Google-Finance-style header. Real data shows cumulative P&L moving
-- by thousands of dollars (tens to ~100 resolved qualified signals/day,
-- summed over weeks) against that $1,000 baseline — the "$1,000 account"
-- framing implies a single literal balance that can't go that deep negative,
-- which is misleading. This is an AGGREGATE benchmark stat (sum of
-- independent fixed-$10-risk outcomes across every qualified signal), not a
-- single-account equity curve. Consumers of this view should present it as
-- "cumulative fixed-risk P&L" / "per-signal expectancy," not as account
-- equity — see the EOD report UI for the corrected framing.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_talaria_fixed_basket_daily AS
WITH resolved AS (
  SELECT
    symbol,
    resolved_at::date AS day,
    pnl_bricks,
    brick_size,
    CASE
      WHEN stop_loss IS NOT NULL AND entry_price IS NOT NULL AND stop_loss <> entry_price
        THEN 10.0 / ABS(entry_price - stop_loss)
      ELSE NULL
    END AS units
  FROM public.nt_signal_sim
  WHERE qualified = true
    AND outcome IN ('tp_hit', 'sl_hit', 'expired')
    AND resolved_at IS NOT NULL
),
daily AS (
  SELECT
    day,
    COUNT(*) AS n_resolved,
    SUM(pnl_bricks * brick_size * units) AS pnl_fixed
  FROM resolved
  WHERE units IS NOT NULL
  GROUP BY day
)
SELECT
  day,
  n_resolved,
  round(pnl_fixed::numeric, 2) AS pnl_fixed,
  round(SUM(pnl_fixed) OVER (ORDER BY day)::numeric, 2) AS cumulative_pnl_fixed,
  round((SUM(pnl_fixed) OVER (ORDER BY day) / NULLIF(SUM(n_resolved) OVER (ORDER BY day), 0))::numeric, 4)
    AS cumulative_expectancy_per_signal
FROM daily
ORDER BY day;

COMMENT ON VIEW public.v_talaria_fixed_basket_daily IS
  'Daily + cumulative P&L from a $10-fixed-risk-per-signal benchmark, aggregated '
  'across every resolved qualified signal (not a single-account equity curve — see '
  'migration comment for why the "$1,000 account" framing was dropped).';

GRANT SELECT ON public.v_talaria_fixed_basket_daily TO anon;
