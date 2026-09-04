-- =============================================================================
-- Noble Trading App — Migration 0014: fix nt_correlation_cache public access
-- =============================================================================
-- Security fix (2026-09-04). Migration 0011's "Service role full access"
-- policy on nt_correlation_cache omitted an explicit `TO service_role`
-- clause, so it defaulted to `roles={public}` — granting every role,
-- including anon, unrestricted SELECT/INSERT/UPDATE/DELETE with `USING (true)`.
-- Combined with this project's schema-wide default-privilege grant (every
-- new table in `public` silently inherited full anon/authenticated access —
-- fixed at the schema level in noble-trader-fastapi-backend migration 134),
-- this table was fully readable/writable/truncatable by the public anon key
-- from the moment it was created. 0011 (checked in alongside this fix) now
-- has the corrected `TO service_role` clause for any fresh deploy; this
-- migration is the corrective ALTER for the already-applied database.
-- =============================================================================

DROP POLICY IF EXISTS "Service role full access" ON public.nt_correlation_cache;
CREATE POLICY "Service role full access" ON public.nt_correlation_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.nt_correlation_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.v_correlation_cache FROM anon, authenticated;
