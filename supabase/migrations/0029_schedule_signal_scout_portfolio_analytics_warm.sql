-- =============================================================================
-- Noble Trading App — Migration 0029: warm portfolio-analytics cache for
-- Signal Scout (the $199 / 10-symbol plan), so its Portfolio-tab matrices
-- (correlation + concurrent-signal agreement) are pre-populated instead of
-- waiting for a user's first `Refresh`.
-- =============================================================================
-- Companion to 0028 (which schedules the same warm for precision_pro).
-- Signal Scout is now an open-access tier on the Portfolio tab
-- (app/api/portfolio-analytics/{correlation,signal-agreement}/route.js no
-- longer 403s non-precision_pro plans), so its per-plan cache
-- (v_correlation_cache / v_signal_agreement_cache are keyed by plan_slug)
-- must be warmed too. The edge function portfolio-analytics-warm already
-- accepts any `plan_slug` and reads that plan's roster via
-- v_talaria_symbols ... plan_ids @> [plan.id], so no edge-function change is
-- needed.
--
-- Staggered 2 minutes after the precision_pro warm (:27 UTC) so the two
-- free-tier Render calls don't land simultaneously.
-- Idempotent: safe to re-run (drops any existing schedule of this name first),
-- mirroring the 0017 / 0028 pattern.
--
-- NOTE: this migration only registers the schedule; it does not run it. Apply
-- it to the live project (supabase db push / dashboard) -- schedules are live
-- state and are not created by the Next.js build.
-- =============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'warm-portfolio-analytics-signal_scout') then
    perform cron.unschedule('warm-portfolio-analytics-signal_scout');
  end if;
end $$;

select cron.schedule(
  'warm-portfolio-analytics-signal_scout',
  '27 */6 * * *',  -- every 6 hours at :27 UTC, staggered from precision_pro's :25
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/portfolio-analytics-warm',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{"plan_slug":"signal_scout"}'::jsonb
    ) as request_id;
  $$
);

