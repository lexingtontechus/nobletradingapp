-- =============================================================================
-- Noble Trading App — Migration 0028: schedule portfolio-analytics-warm pg_cron
-- =============================================================================
-- Replaces 0026 (which scheduled a pg_cron -> Vercel route). The Vercel warm
-- route awaited a ~55s backend call inside a default-budget serverless function,
-- so Vercel killed it before the cache write — the Portfolio analytics caches
-- (nt_correlation_cache / nt_signal_agreement_cache) stayed frozen.
--
-- Scheduled compute belongs in Supabase, not Vercel (Vercel is the web tier).
-- This runs the same work entirely inside a Supabase Edge Function, matching the
-- eod-report-generate / send-renewal-reminders pattern.
--
-- 25 */6 * * * = every 6 hours at :25 UTC (staggered vs other jobs).
-- Same idempotent pattern as 0017: safe to re-run (drops any existing schedule
-- of the same name first).
-- =============================================================================

-- Drop the old Vercel-targeting schedule from 0026 (revert).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'warm-portfolio-analytics') then
    perform cron.unschedule('warm-portfolio-analytics');
  end if;
end $$;

select cron.schedule(
  'warm-portfolio-analytics',
  '25 */6 * * *',  -- every 6 hours at :25 UTC
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/portfolio-analytics-warm',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{"plan_slug":"precision_pro"}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Every 6h at :25 UTC: refreshes the Portfolio analytics caches '
  '(nt_correlation_cache + nt_signal_agreement_cache) for precision_pro via the '
  'portfolio-analytics-warm Edge Function, so member page loads read cache '
  'instead of recomputing on free-tier Render.';
