-- =============================================================================
-- Noble Trading App — Migration 0016: EOD signal accuracy report storage
-- =============================================================================
-- Implements docs/worklog-eod-signal-accuracy-report.md §3.4/§3.6. One row
-- per report_date, holding the full built report (per-symbol data + LLM
-- commentary + whole-digest summary) as jsonb. Generated ONCE per day by
-- app/api/eod-report/generate (never regenerated per page view — see the
-- worklog on why: a shared daily digest, not personalized per user, so
-- caching per view would mean hundreds of subscribers triggering hundreds
-- of duplicate LLM calls for identical content).
--
-- No TTL/expiry: per the worklog's §3.6 decision, rows are kept indefinitely
-- (cheap, structured/text data) — "how far back can a user browse" is a UI
-- query decision, not a storage lifecycle one.
--
-- Policy scoped TO service_role explicitly from the start (the nt_regime_log
-- / nt_correlation_cache incidents earlier this project were both caused by
-- omitting that clause and defaulting to `public`).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nt_eod_report (
  report_date   date PRIMARY KEY,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  payload       jsonb NOT NULL,
  llm_provider  text,
  error         text
);

ALTER TABLE public.nt_eod_report ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.nt_eod_report;
CREATE POLICY "Service role full access" ON public.nt_eod_report
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.nt_eod_report IS
  'One row per report_date — the full built EOD signal accuracy report (data + '
  'LLM commentary), generated once server-side. No anon policy — read/written '
  'server-side only via the service-role key, through v_eod_report.';

CREATE OR REPLACE VIEW public.v_eod_report AS
SELECT report_date, generated_at, payload, llm_provider, error
FROM public.nt_eod_report;

COMMENT ON VIEW public.v_eod_report IS
  '1:1 wrapper over nt_eod_report — app code reads/writes this view, never the raw table.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.v_eod_report TO service_role;
