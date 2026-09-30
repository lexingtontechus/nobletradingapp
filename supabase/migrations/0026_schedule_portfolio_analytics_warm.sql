-- =============================================================================
-- Noble Trading App — Migration 0026: warm portfolio analytics caches
-- =============================================================================
-- Correlation + signal-agreement were visitor-triggered: the first Precision Pro
-- page load after a 12h TTL miss paid free-tier Render cold start + compute
-- (~8–12s). nt_correlation_cache.computed_at was observed frozen at 2026-09-06
-- (silent upsert failures), so every load recompiled.
--
-- This schedule POSTs /api/portfolio-analytics/warm every 6 hours (offset from
-- the dashboard cache refresh) so caches stay hot without a visitor.
--
-- Auth: the warm route accepts X-Supabase-Cron: true (same pattern as
-- eod-report-generate) — no secret embedded in cron SQL.
--
-- Idempotent: drops any existing schedule of the same name first.
-- =============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'warm-portfolio-analytics') then
    perform cron.unschedule('warm-portfolio-analytics');
  end if;
end $$;

select cron.schedule(
  'warm-portfolio-analytics',
  '25 */6 * * *',  -- every 6 hours at :25 UTC (staggered vs other jobs)
  $$
    select net.http_post(
      url     := 'https://nobletrading.app/api/portfolio-analytics/warm',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{"plan_slug":"precision_pro"}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Every 6h at :25 UTC: warm nt_correlation_cache + nt_signal_agreement_cache '
  'for precision_pro via /api/portfolio-analytics/warm so member page loads '
  'read cache instead of recomputing on free-tier Render.';
