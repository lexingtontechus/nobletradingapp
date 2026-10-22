-- =============================================================================
-- Noble Trading App — Migration 0032: Edge Lab upsert helper + view exposure
-- =============================================================================
-- 0031_edge_lab_run (applied 2026-10-21 08:32 UTC) created nt_edge_lab_run and
-- v_edge_lab_run and granted the view to anon — but the RECORDED statement list
-- ends at `GRANT SELECT ON public.v_edge_lab_run TO anon;`.  The
-- `upsert_edge_lab_run(...)` helper at the bottom of that file was never
-- applied (verified against supabase_migrations.schema_migrations), so kairos
-- has no function to call and nt_edge_lab_run stayed empty (0 rows).
--
-- This migration:
--   1. creates the missing upsert helper (idempotent — CREATE OR REPLACE);
--   2. makes v_edge_lab_run `security_invoker` so it follows the table's RLS.
--      A plain view runs with its OWNER's privileges, so `GRANT ... TO anon`
--      on it hands the full 2–3 MB artifact to anyone holding the publishable
--      key — bypassing the table's service-role-only policy.  The dashboard
--      reads this view through its own API route with the service-role key
--      (the same service-role-only grant as v_eod_report, but security_invoker
--      so the table's RLS is actually enforced), so the anon grant served no
--      purpose.
--   3. re-grants service_role explicitly.
--
-- Policy after this migration: service_role writes AND reads; anon reads
-- nothing.  If the page is ever meant to be public, add an explicit anon
-- policy on the TABLE and drop security_invoker — do NOT re-grant the view.
-- =============================================================================

-- 1. the missing helper (idempotent)
CREATE OR REPLACE FUNCTION public.upsert_edge_lab_run(
  p_run_id        text,
  p_generated_at  timestamptz,
  p_engine        text,
  p_symbols       text[],
  p_period_start  timestamptz,
  p_period_end    timestamptz,
  p_bars_total    integer,
  p_payload       jsonb,
  p_note          text DEFAULT NULL
) RETURNS text AS $$
BEGIN
  INSERT INTO nt_edge_lab_run (
    run_id, generated_at, engine, symbols, period_start, period_end, bars_total, payload, note
  ) VALUES (
    p_run_id, p_generated_at, p_engine, p_symbols, p_period_start, p_period_end,
    p_bars_total, p_payload, p_note
  )
  ON CONFLICT (run_id) DO UPDATE
    SET generated_at = EXCLUDED.generated_at,
        engine = EXCLUDED.engine,
        symbols = EXCLUDED.symbols,
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        bars_total = EXCLUDED.bars_total,
        payload = EXCLUDED.payload,
        note = EXCLUDED.note;
  RETURN p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.upsert_edge_lab_run TO service_role;

-- 2. view follows RLS (no owner-privilege bypass).  Same column list as 0031.
CREATE OR REPLACE VIEW public.v_edge_lab_run AS
SELECT
  run_id,
  generated_at,
  engine,
  symbols,
  period_start,
  period_end,
  bars_total,
  payload,
  note
FROM public.nt_edge_lab_run;

ALTER VIEW public.v_edge_lab_run SET (security_invoker = true);

COMMENT ON VIEW public.v_edge_lab_run IS
  '1:1 wrapper over nt_edge_lab_run — the nobletradingapp edge-lab page reads this view, never the raw table.  security_invoker so it follows the table RLS (service-role only).  Returns empty if no run exists.';

-- 3. service-role only
REVOKE SELECT ON public.v_edge_lab_run FROM anon;
GRANT SELECT ON public.v_edge_lab_run TO service_role;

NOTIFY pgrst, 'reload schema';
