-- =============================================================================
-- ADMIN TEST SCRIPT — mint Talaria claim tokens for testing different plans
-- =============================================================================
-- Run in the Supabase SQL editor (postgres role — bypasses the RLS that locks
-- talaria_claims to service-role-only).
--
-- PURPOSE
--   Create test users + ACTIVE subscriptions + claim tokens so you can test
--   the Talaria plugin end-to-end against EACH plan (Signal Scout / Precision
--   Pro): Connect tab → talaria-check Edge Function → dashboard.
--
-- WHAT IT DOES
--   1. Ensures pgcrypto (digest / gen_random_bytes) — enabled by default on
--      Supabase.
--   2. Builds a config table of test users (fixed UUIDs → idempotent re-runs).
--   3. Upserts one TEST USER per plan in public.users (role = 'admin').
--   4. Replaces their subscriptions with a fresh ACTIVE row for the plan, so
--      talaria-check returns sub_status = 'active' and the dashboard unlocks.
--   5. Revokes any prior live claim for those users, then mints NEW claims:
--      raw token = 'test-<plan_slug>-<32 hex>' ; stores ONLY sha256(token)
--      in talaria_claims (migration 0006 — raw tokens are never stored).
--   6. RETURNS the raw tokens in the result grid — copy each into the Talaria
--      plugin → Connect tab.
--
-- SECURITY / NOTES
--   * The raw token appears ONLY in this result grid. It is hashed in the
--     table and can never be recovered — re-run the script to re-mint.
--   * These are LIVE credentials. Use only with test users / a test project
--     you control.
--   * Re-running is safe (idempotent): test users are updated, their old
--     claims revoked, new tokens minted.
--   * Production minting goes through POST /api/talaria-claim (Clerk-gated +
--     subscription check). This script bypasses that gate for ADMIN TESTING
--     ONLY — never ship it as an API route.
-- =============================================================================

-- ── 0. pgcrypto (idempotent) ────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── 1. CONFIG — add/remove test users here (single source of truth) ───────
--    plan_slug must match public.plans.slug (migration 0004 backfills
--    'signal_scout' / 'precision_pro' / 'basket_scalper').
--    user_id values are FIXED so re-runs are stable. If you change an email,
--    make sure it isn't already used by a real user.
drop table if exists _test_claims_config;
create temp table _test_claims_config as
select * from (values
  ('talaria-test-scout@nobletrading.test', 'signal_scout',    '10000000-0000-0000-0000-000000000001'::uuid),
  ('talaria-test-pro@nobletrading.test',    'precision_pro',  '10000000-0000-0000-0000-000000000002'::uuid)
  -- basket_scalper has no client build yet — add when the engine ships:
  -- ('talaria-test-basket@nobletrading.test', 'basket_scalper', '10000000-0000-0000-0000-000000000003'::uuid)
) as cfg(test_email, plan_slug, user_id);

-- ── 2. Guards — fail fast on a bad config instead of silently minting ──────
do $$
declare
  missing text;
  email_clash text;
begin
  -- plan_slug must exist in public.plans
  select string_agg(c.plan_slug, ', ') into missing
  from _test_claims_config c
  where not exists (select 1 from public.plans p where p.slug = c.plan_slug);
  if missing is not null then
    raise exception 'plan_slug not found in public.plans: %', missing;
  end if;

  -- test email must not belong to a DIFFERENT user id (idempotent re-runs
  -- rely on id + email matching)
  select string_agg(c.test_email, ', ') into email_clash
  from _test_claims_config c
  where exists (
    select 1 from public.users u
    where u.email = c.test_email and u.id <> c.user_id
  );
  if email_clash is not null then
    raise exception 'test email already used by another user id: %', email_clash;
  end if;
end $$;

-- ── 3. Upsert test users (idempotent) ──────────────────────────────────────
insert into public.users (id, clerk_user_id, email, role)
select c.user_id, 'test-' || c.user_id, c.test_email, 'admin'
from _test_claims_config c
on conflict (id) do update
  set clerk_user_id = excluded.clerk_user_id,
      email         = excluded.email,
      role          = 'admin',
      updated_at    = now();

-- ── 4. Replace test subscriptions with a fresh ACTIVE row per plan ─────────
--    talaria-check reads the MOST RECENT subscription row (order created_at
--    desc) — deleting + re-inserting keeps the test state deterministic.
delete from public.subscriptions
where user_id in (select user_id from _test_claims_config);

insert into public.subscriptions
  (user_id, plan_id, helio_paylink_id, status,
   current_period_start, current_period_end, grace_period_end)
select c.user_id, p.id, p.helio_paylink_id, 'active',
       now(), now() + interval '30 days', now() + interval '45 days'
from _test_claims_config c
join public.plans p on p.slug = c.plan_slug;

-- ── 5. Revoke prior live claims for the test users ─────────────────────────
--    Single-active-token policy (same as POST /api/talaria-claim step 5);
--    also required by the partial unique index in migration 0006.
update public.talaria_claims
set revoked_at = now()
where user_id in (select user_id from _test_claims_config)
  and revoked_at is null;

-- ── 6. Mint + store claims, RETURN the raw tokens ──────────────────────────
--    raw_token is generated ONCE per row and reused for the sha256 insert,
--    so what you copy from this result grid is exactly what talaria-check
--    will accept.
with
tokens as (
  select c.user_id, c.test_email, c.plan_slug, p.id as plan_id,
         ('test-' || c.plan_slug || '-' || encode(gen_random_bytes(16), 'hex')) as raw_token
  from _test_claims_config c
  join public.plans p on p.slug = c.plan_slug
),
minted as (
  insert into public.talaria_claims (token_hash, user_id, plan_id, expires_at)
  select encode(digest(t.raw_token, 'sha256'), 'hex'), t.user_id, t.plan_id,
         now() + interval '30 days'
  from tokens t
  returning token_hash
)
select t.test_email,
       t.plan_slug,
       t.raw_token,
       now() + interval '30 days' as expires_at,
       'Copy raw_token into Talaria plugin → Connect tab' as how_to_use
from tokens t
order by t.plan_slug;

-- Done. Verify with:
--   select token_hash, user_id, plan_id, expires_at, revoked_at
--   from public.talaria_claims order by created_at desc limit 5;
