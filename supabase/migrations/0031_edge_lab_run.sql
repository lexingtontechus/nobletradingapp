-- =============================================================================
-- Noble Trading App — Migration 0031: Edge Lab run artifact storage
-- =============================================================================
-- The edge lab (regime_edge proof engine) produces a JSON artifact
-- (edge_lab.json, ~1–3 MB) containing verdicts, regime values, calibration,
-- barrier geometry, gate backtest results, and fix manifests.  This table
-- stores the artifact for dashboard consumption.
--
-- Unlike nt_eod_report (per-date), there is only ONE latest run per symbol
-- set.  A new run overwrites the previous.  This is a running audit trail,
-- not a historical archive — the detailed outputs per run live in the kairos
-- worklog, not in Supabase.
--
-- Policy: service_role writes; anon reads via v_edge_lab_run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nt_edge_lab_run (
  run_id        text PRIMARY KEY,            -- UTC YYYYMMDD_HHMMSS
  generated_at  timestamptz NOT NULL DEFAULT now(),
  engine        text NOT NULL,               -- e.g., "regime_edge v1"
  symbols       text[] NOT NULL,             -- snapshot of ACTIVE symbols
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  bars_total    integer NOT NULL,            -- sum(symbol bars)
  payload       jsonb NOT NULL,              -- the full edge_lab.json
  note          text                         -- short human summary
);

ALTER TABLE public.nt_edge_lab_run ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.nt_edge_lab_run;
CREATE POLICY "Service role full access" ON public.nt_edge_lab_run
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.nt_edge_lab_run IS
  'Latest edge lab run artifact (edge_lab.json). Only one row; new runs overwrite. '
  'The dashboard reads via v_edge_lab_run.  Historical runs are in kairos worklog.';

-- View for the dashboard (anon-key readable)
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

COMMENT ON VIEW public.v_edge_lab_run IS
  '1:1 wrapper over nt_edge_lab_run — the nobletradingapp edge-lab page reads this view, never the raw table.  Returns NULL/empty if no run exists.';

GRANT SELECT ON public.v_edge_lab_run TO anon;

-- Helper: upsert the latest run (called by kairos after a successful run)
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