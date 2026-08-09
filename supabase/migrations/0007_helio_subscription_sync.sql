-- =============================================================================
-- Noble Trading App — Migration 0007: Helio subscription reconciliation poller
-- =============================================================================
-- 1. Extends subscription_event_type with SYNC_* markers used by the
--    helio-subscription-sync poller (webhook backstop). Distinct from the
--    webhook's STARTED/RENEWED/ENDED so audit logs show the source.
-- 2. Schedules the helio-subscription-sync Edge Function every 15 minutes.
--    The poller reads Helio's subscription list API (which returns full user
--    identity — email + discordUser — unlike the webhook payload) and
--    reconciles the modern `subscriptions` table.
--
-- Prerequisites:
--   - pg_cron extension enabled (Supabase enables by default)
--   - pg_net extension enabled (Supabase enables by default)
--   - The helio-subscription-sync Edge Function deployed
--   - INTERNAL_FUNCTION_SECRET set on the function for service-to-service
--     auth (optional; the pg_cron path uses X-Supabase-Cron which is always
--     accepted)
-- =============================================================================

-- 1. Extend the event enum (idempotent: only adds if missing)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'subscription_event_type' and e.enumlabel = 'SYNC_STARTED'
  ) then
    alter type subscription_event_type add value 'SYNC_STARTED';
  end if;
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'subscription_event_type' and e.enumlabel = 'SYNC_EXPIRED'
  ) then
    alter type subscription_event_type add value 'SYNC_EXPIRED';
  end if;
end $$;

-- 2. Drop any existing schedule (idempotent re-run).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'helio-subscription-sync') then
    perform cron.unschedule('helio-subscription-sync');
  end if;
end $$;

-- Schedule every 15 minutes. The SQL calls the Edge Function via pg_net.
-- NOTE: the function URL is HARDCODED because setting app.functions_url
-- requires superuser (42501 in the SQL editor + Management API). If you
-- prefer the setting-based form, first run:
--   alter database postgres set app.functions_url to 'https://pcvscowltlrxzgxjurcr.functions.supabase.co';
select cron.schedule(
  'helio-subscription-sync',
  '*/15 * * * *',  -- every 15 minutes
  $$
    select net.http_post(
      url     := 'https://pcvscowltlrxzgxjurcr.functions.supabase.co/helio-subscription-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Every 15 min: poll Helio subscription list API and reconcile the subscriptions table (backstop to helio-webhook).';
