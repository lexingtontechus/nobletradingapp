-- =============================================================================
-- Noble Trading App — Admin Script: Mint a single Talaria claim token
-- =============================================================================
-- Creates a claim token for an EXISTING user, for admin / support / testing use.
-- NOT the production flow (that's POST /api/talaria-claim, Clerk-gated +
-- active-subscription check + 30-day TTL).
--
-- Run in the Supabase SQL Editor (postgres role — bypasses RLS on
-- talaria_claims).
--
-- CONFIGURE THE THREE PARAMETER LINES below (edit the values), then run.
-- The RAW TOKEN appears in the SQL Editor "Output" tab via RAISE NOTICE — copy
-- immediately (only its sha256 hash is stored; it can never be recovered).
--
-- SECURITY: the raw token appears ONLY here. It is hashed in the table.
-- The token proves identity to talaria-check; the LIVE subscriptions row
-- decides access. If the user's subscription is lapsed, talaria-check returns
-- sub_status 'expired' even with a valid token.
-- =============================================================================

-- ── 0. pgcrypto ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;

-- ── 0b. OPTIONAL: also activate the user's subscription ──────────────────────
-- Set to true to upsert an ACTIVE subscription row for the user before minting
-- the claim token. talaria-check re-checks the LIVE subscriptions row — a
-- non-expiring token alone is NOT enough; the subscription must be active.
--
-- >>>>>>>>  EDIT THESE THREE LINES  >>>>>>>>>>>
\set target_user_id  '246dd8e5-94a4-434c-88c0-6af2fe0a4007'
\set target_plan_slug 'precision_pro'
\set claim_ttl_days  36500    -- 36500 ≈ 100 years (effectively never expires)
\set also_activate_sub true     -- true = set/update subscription to 'active'
-- <<<<<<<<<<  EDIT THESE THREE LINES  <<<<<<<<<<

-- ── 0c. Resolve plan_id for subscription upsert ─────────────────────────────
do $$
declare
  v_plan_id uuid;
  v_sub_count int;
begin
  if :'also_activate_sub'::boolean then
    -- Resolve plan_id from slug
    select id into v_plan_id from public.plans where slug = :'target_plan_slug';
    if v_plan_id is null then
      raise exception 'plan_slug ''%'' not found in public.plans. Valid: signal_scout, precision_pro, basket_scalper', :'target_plan_slug';
    end if;

    -- Check if user has any subscriptions
    select count(*) into v_sub_count
    from public.subscriptions
    where user_id = :'target_user_id'::uuid;

    if v_sub_count = 0 then
      -- Insert a new active subscription
      insert into public.subscriptions (
        user_id, plan_id, helio_paylink_id, status,
        current_period_start, current_period_end, grace_period_end
      ) values (
        :'target_user_id'::uuid, v_plan_id, null, 'active',
        now(), now() + interval '30 days', now() + interval '45 days'
      );
      raise notice 'Created new ACTIVE subscription for user';
    else
      -- Update the most recent subscription to active + extend period
      update public.subscriptions
      set status = 'active',
          current_period_start = now(),
          current_period_end = now() + interval '30 days',
          grace_period_end = now() + interval '45 days',
          updated_at = now()
      where user_id = :'target_user_id'::uuid
        and id = (
          select id from public.subscriptions
          where user_id = :'target_user_id'::uuid
          order by created_at desc limit 1
        );
      raise notice 'Updated existing subscription to ACTIVE (30-day extended period)';
    end if;
  end if;
end $$;

-- ── 1. PARAMETERS + MINT ────────────────────────────────────────────────────
-- Edit the three \set lines above, then run the whole DO block.
do $$
declare
  target_user_id  uuid := :'target_user_id'::uuid;
  target_plan_slug text := :'target_plan_slug';
  claim_ttl_days   int := :'claim_ttl_days'::int;

  v_plan_id      uuid;
  v_user_exists  boolean;
  v_raw_token    text;
  v_token_hash   text;
  v_expires_at   timestamptz;
begin
  -- Resolve plan_id (raises if slug not found)
  select id into v_plan_id from public.plans where slug = target_plan_slug;
  if v_plan_id is null then
    raise exception 'plan_slug ''%'' not found in public.plans. Valid: signal_scout, precision_pro, basket_scalper', target_plan_slug;
  end if;

  -- Verify user exists
  select exists (select 1 from public.users where id = target_user_id) into v_user_exists;
  if not v_user_exists then
    raise exception 'user_id ''%'' not found in public.users', target_user_id;
  end if;

  -- Generate raw token + hash (32 random bytes → 64-char hex)
  v_raw_token  := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := now() + (claim_ttl_days || ' days')::interval;

  -- Revoke prior live claims (single-active-token policy)
  update public.talaria_claims
  set revoked_at = now()
  where user_id = target_user_id
    and revoked_at is null;

  -- Insert the new claim
  insert into public.talaria_claims (token_hash, user_id, plan_id, expires_at)
  values (v_token_hash, target_user_id, v_plan_id, v_expires_at);

  -- Output (appears in SQL Editor "Output" tab)
  raise notice '✅ TALARIA TOKEN MINTED — COPY THE RAW TOKEN (shown once)';
  raise notice 'raw_token: %', v_raw_token;
  raise notice 'token_hash: %', v_token_hash;
  raise notice 'user_id: %', target_user_id;
  raise notice 'plan_slug: %', target_plan_slug;
  raise notice 'expires_at: %', v_expires_at;
  raise notice 'revoked_at: (null = active)';

  if :'also_activate_sub'::boolean then
    raise notice 'subscription: active (also_activate_sub = true)';
  end if;
end $$;

-- ── 2. VERIFY: see the stored claim (no raw token in DB) ───────────────────
-- select tc.token_hash, tc.user_id, tc.expires_at, tc.revoked_at, tc.created_at,
--   p.slug as plan_slug
-- from public.talaria_claims tc
-- join public.plans p on p.id = tc.plan_id
-- where tc.user_id = :'target_user_id'::uuid
-- order by tc.created_at desc limit 1;

-- ── 3. VERIFY: simulate talaria-check token presentation ───────────────────
-- select
--   tc.token_hash, tc.expires_at, tc.revoked_at,
--   (tc.expires_at > now()) as token_valid,
--   (tc.revoked_at is null) as token_active
-- from public.talaria_claims tc
-- where tc.token_hash = encode(digest('PASTE_RAW_TOKEN_HERE', 'sha256'), 'hex');
