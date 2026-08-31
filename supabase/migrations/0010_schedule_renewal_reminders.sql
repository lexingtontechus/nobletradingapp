-- =============================================================================
-- Noble Trading App — Migration 0010: Schedule send-renewal-reminders pg_cron
-- =============================================================================
-- FIX: The send-renewal-reminders cron job was documented in 0001_init.sql
-- and 0002_seed_plans.sql as a manual SQL-editor step but was never
-- actually deployed. This migration creates it.
--
-- Because cron.schedule runs as NON-SUPERUSER on Supabase, the function
-- URL must be HARDCODED in the cron body (see 0007_helio_subscription_sync.sql
-- and 0008_talaria_plugin_release_notifications.sql for the same pattern).
-- =============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-renewal-reminders') then
    perform cron.unschedule('send-renewal-reminders');
  end if;
end $$;

select cron.schedule(
  'send-renewal-reminders',
  '0 9 * * *',  -- daily at 09:00 UTC
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/send-renewal-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Daily 09:00 UTC: query v_reminders_due, mint Helio charge URLs, send renewal-reminder emails via AgentMail.to.';
