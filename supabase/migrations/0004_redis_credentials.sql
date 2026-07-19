-- =============================================================================
-- Noble Trading App — Migration 0004: Redis credentials for subscribers
-- =============================================================================
-- Per-subscriber Redis 6+ ACL credentials. Each active subscription gets ONE
-- row here. The password + API key are AES-256-GCM encrypted at rest (the
-- encryption key lives in the REDIS_CRED_ENCRYPTION_KEY env var, shared by
-- the Edge Function that encrypts and the Next.js API route that decrypts).
--
-- Lifecycle:
--   STARTED   → helio-webhook calls redis-credentials-manager(provision)
--                → ACL SETUSER on Redis + INSERT row here (password_version=1)
--   RENEWED   → helio-webhook calls redis-credentials-manager(provision)
--                → idempotent: if active row exists, no-op
--   ENDED     → helio-webhook calls redis-credentials-manager(revoke)
--                → ACL DELUSER on Redis + UPDATE revoked_at here
--   User rotates → /api/redis-credentials/rotate
--                → ACL SETUSER >newpwd then <oldpwd (zero-downtime) +
--                  UPDATE row (bump password_version, rotate rotated_at)
--   Daily cron → sweep-expired-redis-creds catches any sub in
--                expired/cancelled state with non-revoked creds (webhook-miss
--                safety net)
--
-- ACL shape (least-privilege): read-only on signals:* streams, no XADD/XTRIM/
-- DEL/CONFIG/ACL. See redis-credentials-manager/index.ts for the exact rule list.
--
-- Password storage: Web Crypto AES-GCM returns ciphertext||authTag (16 bytes)
-- concatenated, base64-encoded. The IV (12 bytes) is stored separately.
-- Decryption requires both columns + the env-var key.
-- =============================================================================

-- 0. Add a `slug` column to plans so we can derive human-readable stream names
--    (signals:signal_scout vs signals:<uuid>). Idempotent.
alter table public.plans
  add column if not exists slug text;

comment on column public.plans.slug is
  'URL-safe slug (e.g. "signal_scout"). Used as the Redis stream key suffix (signals:<slug>) and as the public plan identifier in URLs. Unique among active plans.';

-- Backfill slugs for the two seeded plans (see 0002_seed_plans.sql). Idempotent.
update public.plans set slug = 'signal_scout'  where lower(title) like 'signal%scout%'  and slug is null;
update public.plans set slug = 'precision_pro' where lower(title) like 'precision%pro%' and slug is null;

-- Add a unique index on slug among active plans (null slugs allowed for plans
-- that don't yet have one — partial index).
create unique index if not exists plans_slug_active_idx
  on public.plans (slug)
  where slug is not null and is_active = true;

-- 1. redis_credentials table
create table if not exists public.redis_credentials (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid not null references public.subscriptions(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  plan_id           uuid not null references public.plans(id) on delete cascade,

  -- Redis ACL username (e.g. "sub_<32 hex chars>"). Globally unique so we can
  -- look it up directly when revoking.
  redis_username    text not null unique,

  -- AES-256-GCM encrypted password. ciphertext includes the 16-byte auth tag
  -- appended (Web Crypto convention). Base64-encoded for easy transport.
  password_cipher   text not null,
  password_iv       text not null,           -- base64 of 12-byte IV
  password_version  integer not null default 1,

  -- Optional NTA API key (separate from Redis password). Same encryption scheme.
  -- Used for future REST API access — included in the credentials bundle so
  -- the user has everything in one place.
  api_key_cipher    text,
  api_key_iv        text,
  api_key_version   integer not null default 1,

  -- Stream + consumer group the subscriber reads from.
  -- stream_name is derived from the plan slug (e.g. "signals:signal_scout").
  -- consumer_group equals redis_username (one group per subscriber → each gets
  -- their own XREADGROUP cursor).
  stream_name       text not null,
  consumer_group    text not null,

  created_at        timestamptz not null default now(),
  rotated_at        timestamptz not null default now(),
  revoked_at        timestamptz,             -- null = active, set = revoked

  -- One active credential set per subscription. Old versions (from rotations)
  -- are marked revoked_at, not deleted, for audit.
  unique (subscription_id, password_version)
);

create index if not exists redis_creds_user_idx
  on public.redis_credentials (user_id)
  where revoked_at is null;

create index if not exists redis_creds_sub_idx
  on public.redis_credentials (subscription_id)
  where revoked_at is null;

create index if not exists redis_creds_username_idx
  on public.redis_credentials (redis_username);

-- RLS: a user can SELECT only their own (non-revoked) creds via the anon key.
-- Server-side code (Edge Functions, Next.js API routes) uses the service role
-- key and bypasses RLS entirely.
alter table public.redis_credentials enable row level security;

create policy redis_creds_self_select
  on public.redis_credentials for select
  to authenticated
  using (
    user_id in (
      select id from public.users
      where clerk_user_id = auth.jwt() ->> 'sub'
    )
  );

comment on table public.redis_credentials is
  'Per-subscriber Redis ACL credentials. Password + API key encrypted at rest (AES-256-GCM). Provisioned on subscription STARTED, revoked on ENDED, rotatable by user.';
comment on column public.redis_credentials.password_cipher is
  'Base64 AES-256-GCM ciphertext with 16-byte auth tag appended (Web Crypto convention). Decrypt with REDIS_CRED_ENCRYPTION_KEY env var.';
comment on column public.redis_credentials.stream_name is
  'Redis Stream key the subscriber reads from (e.g. "signals:signal_scout"). ACL limits them to ~signals:*.';
comment on column public.redis_credentials.consumer_group is
  'XREADGROUP consumer group name (equals redis_username). Each subscriber gets their own cursor.';
