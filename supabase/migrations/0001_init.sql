-- =============================================================================
-- Noble Trading App — Supabase Schema Redesign
-- Migration: 0001_init
-- =============================================================================
-- ARCHITECTURE (cleaned-up flow, verified against Helio API reference):
--
--   Next.js (frontend)                Supabase (backend of record)
--   ─────────────────                 ─────────────────────────────
--   1. Create subscription row        (status = 'pending')
--      → pass id in additionalJSON
--   2. <HelioCheckout paylinkId …      (Helio iframe handles wallet pay)
--        additionalJSON={sub_id}/>
--   3. User pays in crypto             ┐
--      (onSuccess = UI feedback only)  │ Helio fires webhook
--                                      ▼
--                                      4. Edge Function `helio-webhook`
--                                         - verify Bearer + X-Signature (HMAC-SHA256)
--                                         - idempotency check (event_id derived)
--                                         - parse payload.event ∈ {STARTED,RENEWED,ENDED}
--                                         - parse transactionObject.meta.additionalJSON
--                                           (it's a JSON STRING — double-encoded)
--                                         - UPSERT subscriptions (grace_period_days
--                                           read from plans row, NOT hardcoded)
--                                         - INSERT subscription_events
--                                         - INSERT payment_transactions
--                                         - capture customerDetails.discordUser.id
--                                           + email from webhook
--                                      5. pg_cron → Edge Function
--                                         `send-renewal-reminders`
--                                         (isAnonymous=true → Helio does NOT
--                                          email; Supabase owns reminders)
--                                         - query v_reminders_due
--                                         - POST /v1/charge/api-key to mint a
--                                           fresh nextChargeUrl (Helio does NOT
--                                           include it in webhooks)
--                                         - send email via AgentMail
--                                           (POST api.agentmail.to/v0/inboxes/{id}/messages)
--                                         - store next_charge_url + INSERT reminder_emails
--   6. User clicks nextChargeUrl      ┐
--      → pays renewal                 │ Helio fires RENEWED
--                                     ▼ (loop back to step 4)
--
--   7. Grace period expires unpaid → Helio fires ENDED
--      → subscription.status = 'expired' → Discord role auto-removed by
--      Helio's managed Discord bot.
--
-- CORRELATION KEY: additionalJSON.subscription_id (uuid) round-trips from
-- the checkout widget into every webhook payload, tying Helio events to
-- the local subscriptions row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
-- pg_cron + pg_net are created at the project level (Supabase dashboard) because
-- they require superuser. Enable them there, then schedule the reminder job:
--   select cron.schedule(
--     'send-renewal-reminders', '0 9 * * *',
--     $$ select net.http_post(
--       url := 'https://<project>.functions.supabase.co/send-renewal-reminders',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     ) $$
--   );

-- =============================================================================
-- 1. users — local mirror of Clerk users (+ Discord identity)
-- =============================================================================
-- MoonPay/Helio does NOT track user identity beyond a wallet address.
-- This table is the system of record for: email (reminders), discord_id
-- (role sync), clerk_user_id (auth), and role (admin gating).
-- =============================================================================
create type user_role as enum ('member', 'admin');

create table public.users (
  id                uuid primary key default gen_random_uuid(),
  clerk_user_id     text not null unique,        -- Clerk user id (auth source of truth)
  email             text not null unique,        -- renewal-reminder recipient
  discord_id        text unique,                 -- Discord user id (nullable until joined)
  discord_username  text,                        -- Discord username (for logging / bot)
  role              user_role not null default 'member',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index users_discord_id_idx    on public.users (discord_id);
create index users_email_idx         on public.users (email);

comment on table public.users is
  'Local record of users (Clerk auth + Discord identity + email for reminders).';

-- =============================================================================
-- 2. plans — subscription products (mirror of Helio paylinks)
-- =============================================================================
-- One row per Helio Subscription Pay Link. The paylink_id is what the
-- <HelioCheckout> widget receives. Plan-level reminder/grace config is
-- stored here so the cron job knows when to start nagging.
-- =============================================================================
create type plan_interval as enum ('MONTH', 'QUARTER', 'YEAR');

create table public.plans (
  id                     uuid primary key default gen_random_uuid(),
  helio_paylink_id       text not null unique,   -- matches NEXT_PUBLIC_NTA_* env var
  title                  text not null,          -- "Signal Scout" | "Precision Pro"
  description            text,
  price_cents            integer not null,       -- 7900 = $79.00
  currency               text not null default 'USD',
  interval               plan_interval not null default 'MONTH',
  annual_discount_bps    integer,                -- 1000 = 10% off annual (basis points)
  renewal_reminder_days  integer not null default 3 check (renewal_reminder_days between 0 and 30),
  grace_period_days      integer not null default 3 check (grace_period_days between 0 and 30),
  is_active              boolean not null default true,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index plans_is_active_idx on public.plans (is_active);

comment on table public.plans is
  'Subscription products. Each maps 1:1 to a Helio Subscription Pay Link.';

-- =============================================================================
-- 3. subscriptions — one row per subscription lifecycle (NEW / RENEWED / EXPIRED)
-- =============================================================================
-- THE CENTRAL TABLE. Created by Next.js with status='pending' BEFORE the
-- Helio checkout renders. The id (uuid) is passed to Helio via
-- additionalJSON so webhooks can update the correct row.
--
-- Lifecycle (local status vs Helio webhook events):
--   Helio webhook event   →   local status transition
--   ─────────────────────────────────────────────────────
--   (checkout initiated)  →   pending
--   STARTED (initial pay) →   active
--   RENEWED (renewal pay) →   active (period extended)
--   (renewalDate near)    →   grace (set by reminder cron)
--   ENDED (lapsed)        →   expired
--   (user cancels)        →   cancelled
--
--   NOTE: Helio's actual webhook event values are STARTED / RENEWED / ENDED
--   (confirmed via /reference/webhook/paylink-subscription/create). The
--   subscriptions guide page's "SUBSCRIPTION_STARTED" etc. are conceptual
--   labels, NOT the values sent in the `event` field.
-- =============================================================================
create type subscription_status as enum (
  'pending',    -- checkout started, no webhook yet
  'active',     -- STARTED or RENEWED received
  'grace',      -- renewalDate passed, in grace period (set by cron)
  'expired',    -- ENDED received (lapsed)
  'cancelled'   -- user cancelled; will not renew
);

create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.users(id) on delete cascade,
  plan_id                   uuid not null references public.plans(id) on delete restrict,

  -- Helio identifiers. Correlation is via additionalJSON.subscription_id =
  -- this row's id (Helio echoes it back in every webhook payload).
  -- helio_subscription_id is populated from GET /v1/subscriptions (called by
  -- the webhook handler on STARTED) — the webhook itself only carries the
  -- transactionObject, not the subscription resource.
  helio_subscription_id     text unique,
  helio_paylink_id          text not null,        -- denormalized for webhook routing
  helio_transaction_id      text,                 -- most recent tx id (transactionObject.id)
  helio_renewal_date        timestamptz,          -- from GET /v1/subscriptions/{id}.renewalDate

  -- Identity captured at checkout by Helio (from transactionObject.meta.customerDetails).
  -- email is the address the buyer typed at checkout; discordUser.id is
  -- captured IF the paylink requires Discord login. These let us sync the
  -- local users row even if the buyer used a different email for Clerk.
  helio_email               text,
  helio_discord_id          text,
  helio_discord_username    text,

  -- Status + lifecycle dates (UTC). current_period_end = helio_renewal_date.
  -- grace_period_end = current_period_end + plans.grace_period_days (read
  -- from the plan row, NOT hardcoded in the Edge Function).
  status                    subscription_status not null default 'pending',
  current_period_start      timestamptz,
  current_period_end        timestamptz,          -- = helio_renewal_date
  grace_period_end          timestamptz,          -- current_period_end + plan.grace_period_days

  -- Renewal charge link. NOTE: Helio does NOT include nextChargeUrl in its
  -- webhooks (verified via /reference/webhook/overview). The reminder cron
  -- mints a fresh charge by calling POST /v1/charge/api-key and stores the
  -- returned pageUrl here. The charge token is the uuid at the end of pageUrl.
  next_charge_url           text,
  next_charge_token         text,
  next_charge_expires_at    timestamptz,          -- charges expire; refresh if stale

  -- Cancellation
  cancelled_at              timestamptz,
  cancel_reason             text,

  -- Reminder tracking (for the cron job's dedupe + analytics)
  last_reminder_sent_at     timestamptz,
  reminder_count            integer not null default 0,

  -- Audit
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- A user may have only ONE pending/active/grace subscription per plan at a time.
-- (History is preserved via subscription_events; expired/cancelled rows can
--  coexist so a user can re-subscribe after lapse.)
create unique index subscriptions_one_active_per_plan_idx
  on public.subscriptions (user_id, plan_id)
  where (status in ('pending', 'active', 'grace'));

create index subscriptions_user_id_idx              on public.subscriptions (user_id);
create index subscriptions_status_idx               on public.subscriptions (status);
create index subscriptions_helio_sub_id_idx         on public.subscriptions (helio_subscription_id);
create index subscriptions_period_end_due_idx
  on public.subscriptions (current_period_end)
  where (status in ('active', 'grace'));
create index subscriptions_next_charge_token_idx
  on public.subscriptions (next_charge_token)
  where (next_charge_token is not null);

comment on table public.subscriptions is
  'One row per subscription lifecycle. Created pending by Next.js, driven to '
  'active/grace/expired by Helio webhooks. next_charge_url is emailed to the '
  'user by the renewal-reminder cron.';

-- =============================================================================
-- 4. subscription_events — append-only audit log of every webhook event
-- =============================================================================
-- Essential for debugging ("why did this subscription expire?") and for
-- reconstructing lifecycle history. One row per Helio webhook delivery
-- (after idempotency dedupe) + one row per CHECKOUT_INITIATED (Next.js).
-- =============================================================================
create type subscription_event_type as enum (
  'CHECKOUT_INITIATED',            -- Next.js created the pending row
  'STARTED',                       -- Helio webhook: initial payment success
  'RENEWED',                       -- Helio webhook: renewal payment success
  'ENDED',                         -- Helio webhook: subscription lapsed
  'REMINDER_SENT',                 -- reminder cron sent an email
  'CANCELLED',                     -- user cancelled via /api/cancel-subscription
  'CHARGE_CREATED'                 -- reminder cron minted a new charge URL
);

create table public.subscription_events (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  event_type            subscription_event_type not null,
  helio_transaction_id  text,                    -- transactionObject.id
  helio_paylink_id      text,                    -- transactionObject.paylinkId
  amount_minimal        text,                    -- transactionObject.meta.amount (raw, e.g. "9900000")
  amount_cents          integer,                 -- converted from minimal using token decimals
  currency              text,                    -- token symbol, e.g. "USDC"
  sender_wallet         text,                    -- transactionObject.meta.senderPK
  next_charge_url       text,                    -- for CHARGE_CREATED events
  next_charge_token     text,
  raw_payload           jsonb not null,           -- full webhook body (audit)
  received_at           timestamptz not null default now()
);

create index events_subscription_id_idx   on public.subscription_events (subscription_id);
create index events_event_type_idx        on public.subscription_events (event_type);
create index events_received_at_idx       on public.subscription_events (received_at);

comment on table public.subscription_events is
  'Append-only audit trail. raw_payload retains the full Helio webhook body.';

-- =============================================================================
-- 5. webhook_idempotency — dedupe Helio's up-to-12× retries
-- =============================================================================
-- Helio retries failed webhooks up to 12 times. We must process each event
-- exactly once. event_id comes from the Helio payload (or header); if absent,
-- the Edge Function derives one as sha256(raw_body).
-- =============================================================================
create table public.webhook_idempotency (
  id              uuid primary key default gen_random_uuid(),
  event_id        text not null unique,           -- Helio event id (or derived hash)
  event_type      text not null,
  processed_at    timestamptz not null default now(),
  status          text not null,                  -- 'processed' | 'error'
  error_message   text
);

create index webhook_idempotency_event_id_idx on public.webhook_idempotency (event_id);

comment on table public.webhook_idempotency is
  'Dedupes Helio webhook retries (up to 12x). Edge Function checks this first.';

-- =============================================================================
-- 6. payment_transactions — one row per payment (initial + each renewal)
-- =============================================================================
-- Drives the admin revenue charts (replaces the old widget_payments_* views).
-- A new row is inserted on every SUBSCRIPTION_STARTED event (initial or
-- renewal). The amount is in cents to avoid float drift.
-- =============================================================================
create table public.payment_transactions (
  id                    uuid primary key default gen_random_uuid(),
  subscription_id       uuid not null references public.subscriptions(id) on delete cascade,
  user_id               uuid not null references public.users(id) on delete cascade,
  plan_id               uuid not null references public.plans(id) on delete restrict,

  helio_transaction_id  text unique,              -- transactionObject.id
  helio_charge_token    text,                     -- the charge token (uuid) if created via charge API
  -- Amount in raw minimal units (lamports/sats/wei). For USDC on Solana
  -- (6 decimals), 79_000_000 minimal = 79.00 USDC. amount_cents is derived.
  amount_minimal        text not null,            -- transactionObject.meta.amount (string)
  amount_decimal        numeric(18,8),            -- human-readable (tokenQuote.fromAmountDecimal)
  amount_cents          integer not null,         -- derived: decimal * 100 (USD-stablecoins)
  token_symbol          text not null default 'USDC',  -- tokenQuote.from
  token_decimals        integer not null default 6,     -- decimals for the token
  currency              text not null default 'USD',   -- display currency
  payment_method        text,                     -- 'crypto' | 'fiat'
  wallet_address        text,                     -- transactionObject.meta.senderPK
  tx_signature          text,                     -- transactionObject.meta.transactionSignature
  submit_geolocation    text,                     -- transactionObject.meta.submitGeolocation (ISO country)
  status                text not null default 'success',  -- 'success' | 'pending' | 'failed'
  is_renewal            boolean not null default false,    -- false on STARTED, true on RENEWED
  paid_at               timestamptz not null default now(),  -- transactionObject.createdAt
  raw_payload           jsonb
);

create index payments_subscription_id_idx  on public.payment_transactions (subscription_id);
create index payments_user_id_idx          on public.payment_transactions (user_id);
create index payments_paid_at_idx          on public.payment_transactions (paid_at desc);
create index payments_plan_id_paid_at_idx  on public.payment_transactions (plan_id, paid_at desc);

comment on table public.payment_transactions is
  'One row per payment (initial + each renewal). Drives admin revenue charts.';

-- =============================================================================
-- 7. reminder_emails — track every renewal reminder sent
-- =============================================================================
-- Because isAnonymous=true, Helio sends NO emails. Supabase owns the entire
-- reminder cadence. This table dedupes (one reminder per day per subscription)
-- and provides analytics on reminder effectiveness.
-- =============================================================================
create table public.reminder_emails (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid not null references public.subscriptions(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  email             text not null,
  charge_url        text not null,               -- the nextChargeUrl we linked to
  reminder_number   integer not null,            -- 1st, 2nd, 3rd reminder…
  sent_at           timestamptz not null default now(),
  status            text not null default 'sent' -- 'sent' | 'failed' | 'bounced'
);

create index reminders_subscription_id_idx  on public.reminder_emails (subscription_id);
create index reminders_sent_at_idx          on public.reminder_emails (sent_at desc);

comment on table public.reminder_emails is
  'Audit of renewal reminders sent (Supabase owns reminders, Helio is anonymous).';

-- =============================================================================
-- Triggers — keep updated_at fresh
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger trg_plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Clients (browser) use the anon key + JWT → RLS applies.
-- Edge Functions use the service role key → RLS bypassed (full access).
-- =============================================================================

alter table public.users               enable row level security;
alter table public.plans               enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.subscription_events enable row level security;
alter table public.webhook_idempotency enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.reminder_emails    enable row level security;

-- users: a user sees/edits only their own row.
-- auth.jwt() ->> 'sub' is the Clerk user id when using Clerk + Supabase JWT.
create policy "users self select" on public.users
  for select using (auth.jwt() ->> 'sub' = clerk_user_id);
create policy "users self update" on public.users
  for update using (auth.jwt() ->> 'sub' = clerk_user_id);

-- plans: everyone can read active plans (pricing page is public).
create policy "plans public read" on public.plans
  for select using (is_active = true);

-- subscriptions: a user sees only their own.
create policy "subscriptions self select" on public.subscriptions
  for select using (
    user_id in (
      select id from public.users
      where clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

-- subscription_events: a user sees events for their own subscriptions.
create policy "events self select" on public.subscription_events
  for select using (
    subscription_id in (
      select s.id from public.subscriptions s
      join public.users u on s.user_id = u.id
      where u.clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

-- payment_transactions: a user sees their own payment history.
create policy "payments self select" on public.payment_transactions
  for select using (
    user_id in (
      select id from public.users
      where clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

-- webhook_idempotency + reminder_emails: server-only (no client policies).
-- Edge Functions use the service role key, bypassing RLS.

-- =============================================================================
-- Views — for the admin dashboard (replaces old widget_* tables)
-- =============================================================================

-- Active + grace subscriptions with user + plan details.
create view public.v_active_subscriptions as
select
  s.id as subscription_id,
  s.status,
  s.current_period_start,
  s.current_period_end,
  s.grace_period_end,
  s.next_charge_url,
  s.reminder_count,
  s.last_reminder_sent_at,
  u.id   as user_id,
  u.email,
  u.discord_id,
  u.discord_username,
  u.clerk_user_id,
  p.id   as plan_id,
  p.title as plan_title,
  p.price_cents,
  p.interval
from public.subscriptions s
join public.users u  on s.user_id = u.id
join public.plans p  on s.plan_id = p.id
where s.status in ('active', 'grace');

-- Monthly revenue by plan (drives admin area/bar charts).
create view public.v_revenue_summary as
select
  date_trunc('month', paid_at) as month,
  p.title as plan_title,
  count(*)                     as payment_count,
  sum(pt.amount_cents)         as revenue_cents,
  count(*) filter (where pt.is_renewal)     as renewals,
  count(*) filter (where not pt.is_renewal) as new_subscriptions
from public.payment_transactions pt
join public.plans p on pt.plan_id = p.id
where pt.status = 'success'
group by 1, 2
order by 1 desc;

-- Subscription counts by plan + status (drives admin bar charts).
create view public.v_subscription_counts_by_plan as
select
  p.id    as plan_id,
  p.title as plan_title,
  count(*) filter (where s.status = 'pending')   as pending_count,
  count(*) filter (where s.status = 'active')    as active_count,
  count(*) filter (where s.status = 'grace')     as grace_count,
  count(*) filter (where s.status = 'expired')   as expired_count,
  count(*) filter (where s.status = 'cancelled') as cancelled_count
from public.plans p
left join public.subscriptions s on s.plan_id = p.id
group by p.id, p.title;

-- Subscriptions due for a renewal reminder RIGHT NOW.
-- The cron Edge Function queries this view, mints a fresh charge URL via
-- POST /v1/charge/api-key (Helio does NOT include nextChargeUrl in webhooks),
-- sends the email via AgentMail, then updates subscriptions.last_reminder_sent_at
-- + reminder_count + next_charge_url.
--
-- NOTE: next_charge_url is NOT required to be non-null here (unlike the old
-- design) — the cron creates it on demand. We only require current_period_end
-- (set by the webhook handler from GET /v1/subscriptions/{id}.renewalDate).
create view public.v_reminders_due as
select
  s.id                as subscription_id,
  s.user_id,
  u.email,
  u.discord_username,
  s.plan_id,
  p.title             as plan_title,
  p.helio_paylink_id,
  p.price_cents,
  p.currency,
  p.interval,
  s.current_period_end,
  s.grace_period_end,
  s.next_charge_url,             -- may be null; cron will mint one
  s.next_charge_token,
  s.next_charge_expires_at,
  s.reminder_count,
  s.last_reminder_sent_at,
  p.renewal_reminder_days,
  p.grace_period_days
from public.subscriptions s
join public.users u  on s.user_id = u.id
join public.plans p  on s.plan_id = p.id
where s.status in ('active', 'grace')
  and s.current_period_end is not null
  -- due: within renewal_reminder_days of expiry (active) OR already past due (grace)
  and s.current_period_end <= now() + make_interval(days => p.renewal_reminder_days)
  -- not yet reminded today (at most one reminder per 24h)
  and (
    s.last_reminder_sent_at is null
    or s.last_reminder_sent_at < now() - interval '24 hours'
  );

comment on view public.v_reminders_due is
  'Rows the send-renewal-reminders cron should email right now. The cron mints
  the charge URL via POST /v1/charge/api-key (Helio webhooks do not include it).
  One reminder per 24h per subscription.';

-- =============================================================================
-- Done. Seed plans next (see 0002_seed_plans.sql).
-- =============================================================================
