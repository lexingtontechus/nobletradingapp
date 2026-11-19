# Scope: TSFM Lab hosting — frontend side (route proxy contract)

> **Date:** 2026-11-18
> **Decision doc (authoritative, REVISED 2026-11-18):**
> `nobletradingapp/docs/scope-tsfm-lab-cloudflare.md` — the harness moves to a
> **Cloudflare Worker (`tsfm-lab`, Workers Paid)** with a native R2 binding, NOT
> to the Render backend. The Render co-deploy decision in
> `nobletradingapp-backend/docs/SCOPE-tsfm-lab-hosting.md` is superseded for the
> harness (that doc's backend-stays-on-Render verdict stands). Supabase Edge was
> rejected on a measured limit (2 s CPU/request vs 3.3 s measured cold eval).
> The Vercel routes become thin authenticated proxies **to the lab Worker**
> (shared-secret header, server-side). The proxy contract below applies with
> `WEBAPP_BACKEND_URL` → the `tsfm-lab` Worker URL and the same secret pattern;
> the data layer becomes R2-authoritative + hourly TDVA refresh (new doc §4).
> No lab math changes.

## What stays in this repo

- `lib/tsfm-lab/*` — **source of truth for the instrument** (8 modules, 3,464 lines).
  The backend vendors a pinned copy via its `scripts/sync_tsfm_lab.py` +
  `SOURCE.json` hash test; drift fails loudly there. Edit the lab here, sync there.
- `lib/tsfm-lab/design.ts` — components keep importing MODELS/COVARIATES/types for
  UI labels and lane discipline. After the flip this is a UI contract copy; numeric
  drift surfaces as a 400 from the backend's lane validation, not silent numbers.
- `data/tsfm/*.csv` — local-dev fallback only. Production reads R2 through the
  Worker bridge (`https://nt-tsfm-data.lexington.workers.dev/tsfm/`, verified live
  2026-11-18). **Open item:** confirm `TSFM_R2_URL` is set in Vercel prod env —
  local `.env.local` lacks it, so prod may be reading bundled CSVs today.
- `mini-services/tsfm-sidecar/` — remains the sidecar's source; Phase 3 of the
  decision doc co-deploys it on Render (gated on the Timestral weights'
  Modified-MIT **revenue cap** clearance — a production subscription app must
  clear that licence before the real-model arm ships).
- `app/dashboard/tsfm-lab/` — the page and components are untouched; the JSON
  contracts (`ForecastResponse`, `EvalResponse`, overview payload) are preserved
  byte-for-byte by the parity gate.

## What changes (Phase 2 of the decision doc)

`app/api/tsfm-lab/{overview,forecast,eval}/route.ts` stop importing
`@/lib/tsfm-lab/harness` and become server-side proxies:

```
runtime = "nodejs", maxDuration = 60 (unchanged)
validation stays in the route (SERIES/TARGETS/MODEL_LANES/horizon checks — today's code)
fetch(`${process.env.WEBAPP_BACKEND_URL}/webapp/tsfm-lab/<op>`, {
  headers: { "X-API-Key": process.env.WEBAPP_BACKEND_API_KEY },
  ...
})
```

- Both env vars already exist in `.env.local` (used by the portfolio-analytics
  surface). The key never reaches the browser — the proxy is server-side.
- Precedent: `app/api/portfolio-analytics/*` (cache-read routes) + the
  `portfolio-analytics-warm` edge function header doctrine — *"Vercel is the web
  tier only"* (2026-10-05, after a ~55 s compute call was killed mid-flight).
- The 60 s proxy budget covers stand-in cells even on Render free CPU (estimated
  ~30–60 s worst cold cell; decision doc §7). Real-arm cells are **batch-only**
  until the Phase-3 CPU decision — the route should surface the backend's
  `timestral.available: false` honestly, exactly as today.
- New (optional, Phase 2): a batch-status read surface for the 20-cell matrix
  artefacts in R2 (`lab/` prefix, same Worker bridge). The matrix is a research
  artefact, not a dashboard dependency — on-demand first, pg_cron trigger later
  if wanted (`lab-matrix-warm`, the portfolio-analytics-warm pattern).

## Acceptance (frontend gate)

1. Dashboard lab renders identically: fan chart, covariate panel + importance,
   eval metric table, PIT, verdict text — against the same pinned harness commit.
2. Route responses JSON-diff = 0 vs the pre-flip in-process routes on the sample
   grid (5 series × 3 targets × h∈{1,6,24,72}, stand-in arms), excluding timestamps.
3. `npm run build` + lint green; no harness import remains in any route file.
4. MT5/talaria surfaces untouched (the lab has no copy-path contract).

## Not in scope here

No component redesign, no new lab features, no arm/protocol changes, no TimesFM
swap, and no conflation with the claims-layer `tsfm` vol-fan arm (that reads the
*TimesFM 2.5* sidecar on the trading backend — different model, different thread).
