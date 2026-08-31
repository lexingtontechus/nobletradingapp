-- =============================================================================
-- Migration 0008: Talaria plugin release notifications
-- =============================================================================
-- Supports email notifications to subscribers when a new Talaria plugin version
-- is published to GitHub Releases. The check-and-notify edge function
-- (`check-talaria-release`) runs daily via pg_cron, polls the GitHub Releases
-- API for the latest tag, and emails all active/grace subscribers who haven't
-- been notified of that version yet.
--
-- Tables created:
--   plugin_release_notifications  — audit of every email sent (dedupe + analytics)
--
-- Columns added to existing tables:
--   (none — the notifications table is self-contained with user_id FK)
--
-- pg_cron schedule (user applies via SQL editor, NOT this migration —
-- see send-renewal-reminders pattern in 0001_init.sql for the recipe):
--   select cron.schedule(
--     'check-talaria-release', '0 9 * * *',
--     $$ select net.http_post(
--         url := 'https://<project>.functions.supabase.co/check-talaria-release',
--         headers := jsonb_build_object(
--           'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--           'Content-Type', 'application/json'
--         ),
--         body := '{}'
--       ) $$
--   );
--
-- NOTE: cron.schedule runs as NON-SUPERUSER on Supabase; the function URL must
-- be HARDCODED in the cron body. If app.functions_url is unset (404), recrate
-- the cron with the explicit URL — see helio_subscription_reconciliation.md
-- for the verified fix pattern.
-- =============================================================================

-- =============================================================================
-- plugin_release_notifications — audit table
-- =============================================================================
create table if not exists public.plugin_release_notifications (
  id                uuid           primary key default gen_random_uuid(),
  user_id           uuid           not null references public.users(id) on delete cascade,
  version           text           not null,        -- e.g. "0.2.14" (no 'v' prefix)
  version_tag       text           not null,        -- e.g. "v0.2.14" (with 'v' prefix)
  sent_at           timestamptz    not null default now(),
  agentmail_message_id text,                        -- for delivery webhook correlation
  status            text           not null default 'sent',  -- sent | failed | bounced
  error             text,                           -- error detail if status = failed
  created_at        timestamptz    not null default now()
);

create index plugin_release_notif_user_version_idx on public.plugin_release_notifications (user_id, version);
create index plugin_release_notif_version_idx     on public.plugin_release_notifications (version desc);
create index plugin_release_notif_sent_at_idx       on public.plugin_release_notifications (sent_at desc);

comment on table public.plugin_release_notifications is
  'Audit of Talaria plugin release notification emails sent to subscribers. '
  'One row per (user, version) — idempotent sends via AgentMail Idempotency-Key '
  'are reflected in agentmail_message_id (deduped within 24h).';

-- =============================================================================
-- v_talaria_release_eligible — active/grace subscribers who haven't seen a version
-- =============================================================================
-- Returns subscribers eligible to receive a notification for a given version.
-- The edge function calls this with a specific version tag and iterates the rows.
-- Using a VIEW (not a parameterized function) so the edge function fetches all
-- eligible rows + version data in one query, then filters client-side.
--
-- The edge function logic:
--   1. Fetch latest release from GitHub API → { tag_name, name, body, html_url, assets }
--   2. Extract version: tag_name.replace(/^v/, '')  →  "0.2.14"
--   3. Query v_talaria_release_eligible → rows where NOT EXISTS notification for this version
--   4. For each row: format email + send via AgentMail with Idempotency-Key
--   5. INSERT into plugin_release_notifications (or update error if failed)
--
create or replace view public.v_talaria_release_eligible as
  select
    u.id          as user_id,
    u.email       as email,
    u.discord_username as discord_username,
    s.id          as subscription_id,
    s.status      as sub_status,
    s.current_period_end,
    p.id          as plan_id,
    p.slug        as plan_slug,
    p.title       as plan_title,
    p.price_cents as price_cents,
    p.currency    as currency
  from public.subscriptions s
  join public.users u             on u.id = s.user_id
  join public.plans p             on p.id = s.plan_id
  where s.status in ('active', 'grace')
    and u.email is not null
    and u.email != '';

-- =============================================================================
-- RLS: plugin_release_notifications is service-role-only (no client policies)
-- =============================================================================
-- The edge function reads/writes this table with the service role key.
-- No client-facing RLS policy is needed — this table is internal audit only.
alter table public.plugin_release_notifications enable row level security;
revoke all on public.plugin_release_notifications from anon;
revoke all on public.plugin_release_notifications from authenticated;
grant all on public.plugin_release_notifications to service_role;
