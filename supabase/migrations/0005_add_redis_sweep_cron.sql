-- =============================================================================
-- Noble Trading App — Migration 0005: pg_cron schedule for daily Redis sweep
-- =============================================================================
-- Schedules the sweep-expired-redis-creds Edge Function to run daily at 03:00
-- UTC (off-peak for US-based trading users). The sweep catches Redis
-- credentials that should have been revoked by the webhook but weren't
-- (webhook delivery failures, manual cancellations, etc.).
--
-- Prerequisites:
--   - pg_cron extension enabled (Supabase enables this by default)
--   - pg_net extension enabled for outbound HTTP (Supabase enables this by default)
--   - The sweep-expired-redis-creds Edge Function deployed
--   - For production hardening: store the INTERNAL_FUNCTION_SECRET in a
--     secure location and inject it into the pg_net request header. For
--     initial deployment we've made the sweep function accept pg_net's
--     User-Agent as auth (see the function's auth check).
-- =============================================================================

-- Drop any existing schedule (idempotent re-run).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sweep-expired-redis-creds') then
    perform cron.unschedule('sweep-expired-redis-creds');
  end if;
end $$;

-- Schedule daily at 03:00 UTC. The cron.schedule call returns the job id.
-- The SQL calls the Edge Function via pg_net's http_post.
select cron.schedule(
  'sweep-expired-redis-creds',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$
    select net.http_post(
      url     := current_setting('app.functions_url') || '/sweep-expired-redis-creds',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Supabase-Cron', 'true'
      ),
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

comment on schedule cron.job_schedule is
  'Daily 03:00 UTC sweep of expired/cancelled subscriptions with non-revoked Redis credentials. Calls the sweep-expired-redis-creds Edge Function via pg_net.';

-- Note: `app.functions_url` is a custom Postgres setting you must set once:
--   alter database postgres set app.functions_url to 'https://<your-project>.functions.supabase.co';
-- (Or hardcode the URL above if you prefer.)
