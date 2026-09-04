-- =============================================================================
-- Noble Trading App — Migration 0012: v_correlation_cache view
-- =============================================================================
-- app/api/portfolio-analytics/correlation was reading/writing nt_correlation_cache
-- directly — the only route in the app talking straight to a raw nt_* table
-- instead of a v_* view (every other Pro table — nt_symbol, nt_paper_positions,
-- nt_renko_bricks — is only ever accessed through its v_talaria_*/v_paper_*
-- wrapper). This is a plain 1:1 view over the same table, kept simple enough
-- to remain auto-updatable in Postgres (single relation, no aggregates/DISTINCT),
-- so PostgREST can still serve the route's select() and upsert() through it.
-- The route is updated to use v_correlation_cache instead of the raw table.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_correlation_cache AS
SELECT plan_slug, computed_at, window_days, symbols, payload, error
FROM public.nt_correlation_cache;

COMMENT ON VIEW public.v_correlation_cache IS
  '1:1 wrapper over nt_correlation_cache — app code reads/writes this view, never the raw table. '
  'Server-only: granted to service_role only, no anon/authenticated grant (matches the table''s RLS intent).';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.v_correlation_cache TO service_role;
