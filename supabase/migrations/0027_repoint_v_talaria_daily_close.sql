-- =============================================================================
-- Noble Trading App — Migration 0027: repoint v_talaria_daily_close
-- =============================================================================
-- WHY: v_talaria_daily_close (migration 0011) resamples nt_renko_bricks, whose
-- `session_date` is mis-stamped — 76,884 of 86,106 bricks (89%) carry
-- session_date = 2026-10-04 regardless of their actual `ts` (which span 30+
-- days). The view's DISTINCT ON (symbol, session_date) therefore collapses ~30
-- real trading days into 3 distinct session_dates, so the Portfolio tab's
-- correlation matrix (nobletradingapp-backend's fetch_daily_closes) sees ~1-2
-- returns per pair and renders near-empty / insufficient_history.
--
-- nt_daily_close (noble-trader-fastapi-backend migration 190) is the
-- purpose-built replacement: one correct row per (symbol, session_date), kept
-- current nightly by daily_close_snapshot.py, anon-readable. It exposes exactly
-- the columns this view already returns (symbol, session_date, close_price, ts).
--
-- This repoint is a pre-planned, deferred item — noble-trader-fastapi-backend's
-- worklog 20261001_NT_RENKO_BRICKS_TIMEOUT_AND_GROWTH.md §13 built
-- nt_daily_close specifically to become this view's source and deferred the
-- repoint to "its own scope doc + approval in nobletradingapp" (see
-- docs/scope-correlation-daily-close-repoint.md). It also decouples
-- correlation from nt_renko_bricks retention (Track A will prune that table;
-- see docs/worklog-renko-bricks-retention-contract.md).
--
-- Zero caller change: nobletradingapp-backend reads this view BY NAME
-- (fetch_daily_closes), and supabase/functions/eod-report-generate reads it for
-- "current price". Both keep working, now against correct data.
--
-- IDEMPOTENT: CREATE OR REPLACE VIEW (same column names/order/types) + GRANT.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_talaria_daily_close AS
SELECT
  symbol,
  session_date,
  close_price,
  ts
FROM public.nt_daily_close;

COMMENT ON VIEW public.v_talaria_daily_close IS
  'One closing price per (symbol, session_date), sourced from nt_daily_close '
  '(correct session_date stamping) — NOT resampled from nt_renko_bricks. Used to '
  'build a synchronized log-returns matrix for the Portfolio tab correlation '
  'matrix (nobletradingapp-backend fetch_daily_closes) and as the EOD report''s '
  'current-price proxy. Repointed by migration 0027 (2026-10-04).';

GRANT SELECT ON public.v_talaria_daily_close TO anon;

-- =============================================================================
-- POST-RUN VERIFICATION (paste into Supabase SQL editor):
--   SELECT count(DISTINCT session_date), min(session_date), max(session_date)
--   FROM public.v_talaria_daily_close;
--   -- expect ~7 sessions today (was 3), rising ~1/day, spanning 2026-09-28+
-- =============================================================================
