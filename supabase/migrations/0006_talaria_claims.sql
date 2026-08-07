-- =============================================================================
-- Noble Trading App — Migration 0006: Talaria claim tokens
-- =============================================================================
-- Claim tokens let the Talaria desktop client (Hermes plugin) authenticate
-- against Supabase WITHOUT shipping a Clerk secret or client SDK in the
-- plugin. Flow:
--
--   Portal (Clerk web, POST /api/talaria-claim)  → mints a 32-byte hex
--                                                   token, stores ONLY
--                                                   sha256(token) in this
--                                                   table, returns the raw
--                                                   token to the user once.
--   Talaria client (Connect tab)                 → stores { supabase_url,
--                                                   public anon key, claim
--                                                   token } locally.
--   talaria-check Edge Function                  → hashes the presented
--                                                   token, looks it up here,
--                                                   then re-checks the LIVE
--                                                   subscriptions row on
--                                                   every call. The token
--                                                   proves identity; the
--                                                   subscription decides
--                                                   access.
--
-- Security notes:
--   * ONLY the SHA-256 hash is ever stored. The raw token is returned to the
--     user exactly once at mint time and can never be recovered from the DB.
--   * RLS is enabled with NO policies: this table is service-role-only. Edge
--     Functions + Next.js server routes use the service role key (bypasses
--     RLS); the public anon key (which the Talaria client uses for the public
--     signals channel) can NEVER read or write claims.
--   * Single-active-token policy: minting a new token revokes the user's
--     other live claims, and the partial unique index below enforces at most
--     one non-revoked claim per user at the DB level.
--   * plan_id is on delete restrict (a plan with claim history cannot be
--     deleted); user_id is on delete cascade (claims die with the user).
-- =============================================================================

-- token_hash is the PRIMARY KEY: it is the ONLY lookup key (talaria-check
-- resolves claims by hash), so a surrogate id column adds nothing.
create table if not exists public.talaria_claims (
  token_hash        text primary key,          -- sha256 hex of the claim token
  user_id           uuid not null references public.users(id) on delete cascade,
  plan_id           uuid not null references public.plans(id) on delete restrict,
  expires_at        timestamptz not null,      -- mint time + 30 days
  revoked_at        timestamptz,               -- null = active, set = revoked
  last_validated_at timestamptz,               -- last successful talaria-check
  created_at        timestamptz not null default now()
);

-- Lookup of a user's claims (revoke-others on mint, admin queries).
create index if not exists talaria_claims_user_idx
  on public.talaria_claims (user_id);

-- Expiry sweeps (revoke stale claims).
create index if not exists talaria_claims_expires_at_idx
  on public.talaria_claims (expires_at);

-- Single-active-token policy enforced at the DB level: at most one
-- non-revoked claim per user.
create unique index if not exists talaria_claims_one_active_per_user_idx
  on public.talaria_claims (user_id)
  where revoked_at is null;

-- RLS on with NO policies (intentional — service-role-only table).
alter table public.talaria_claims enable row level security;

comment on table public.talaria_claims is
  'SHA-256 hashes of Talaria client claim tokens. Raw tokens are never stored (returned once at mint). RLS on with no policies — service-role-only access.';
comment on column public.talaria_claims.token_hash is
  'SHA-256 hex digest of the claim token (never the raw token). Primary lookup key.';
comment on column public.talaria_claims.last_validated_at is
  'Timestamp of the last successful talaria-check validation (best-effort update by the Edge Function).';
