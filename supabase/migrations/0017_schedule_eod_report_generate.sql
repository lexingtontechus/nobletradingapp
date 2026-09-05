-- =============================================================================
-- Noble Trading App — Migration 0017: schedule eod-report-generate pg_cron
-- =============================================================================
-- Runs the EOD signal accuracy report build once daily, entirely inside
-- Supabase (see supabase/functions/eod-report-generate) — deliberately not
-- via Vercel/Next.js, since the actual work (queries + up to ~20 sequential-
-- fallback LLM calls) risks Vercel's serverless execution-time caps.
--
-- 21:00 UTC = 5pm EDT / 4pm EST — after NYSE close (20:00 UTC EDT / 21:00 UTC
-- EST) in both daylight-saving states, so equity-session data has settled
-- before the report runs. Adjust if the plan's symbol mix shifts more toward
-- 24/5 FX/crypto where "close" is less meaningful.
--
-- Same idempotent pattern as 0010_schedule_renewal_reminders.sql: safe to
-- re-run this migration (drops any existing schedule of the same name first).
-- =============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'eod-report-generate') then
    perform cron.unschedule('eod-report-generate');
  end if;
end $$;

select cron.schedule(
  'eod-report-generate',
  '0 21 * * *',  -- daily at 21:00 UTC
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/eod-report-generate',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Daily 21:00 UTC: builds the EOD signal accuracy report (new/resolved qualified '
  'signals, calibration, fixed-risk benchmark, LLM commentary) via the '
  'eod-report-generate Edge Function, upserted into v_eod_report.';
