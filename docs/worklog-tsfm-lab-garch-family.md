# Worklog — GARCH family ported into the TSFM-lab (vol lane)

**Date:** 2026-10-28
**Repo:** nobletradingapp @ `7755134` (uncommitted working-tree changes)
**Task:** "garch is missing in nobletradingapp repo (not kairos) — help implement it."

## Context

The TSFM-lab port (commit `7755134`) shipped 7 model arms. The sibling measurement
lab (`/home/z/my-project`, `src/lib/tsfm/`) has since grown a GARCH-family
implementation (GARCH(1,1)-N, GJR-GARCH(1,1)-t = TGARCH, EGARCH(1,1)-t — mirroring
Cho & Matteson arXiv 2610.31621's candidate set) that was never ported here.
kairos itself only has vanilla GARCH(1,1)-N inside the research-only
`vol_backtest/arms.py` (optional `arch` dep) — this repo was the gap.

## What was added (7 edit sites + 1 bug fix)

1. **`lib/tsfm-lab/garch.ts` (new, ~490 LOC)** — verbatim port of the lab's
   GARCH family. Hand-rolled MLE (Nelder–Mead, 3 multi-starts + restart;
   hard/soft constraints: exp-positivity, 0.9995·sigmoid/·tanh stability,
   1e7·(p−0.9985)² soft penalty), unit-variance return rescaling for the fit,
   standardized-t log-likelihood (Lanczos lnΓ), causal bar-space filter that
   carries state across FX weekend gaps, multi-step aggregate conditional
   variance V_h = Σ σ²_{T+j|T} (EGARCH mean-reverting log-variance recursion,
   GJR persistence α+γ/2+β), and calibration-honest empirical residual
   quantiles (0.5·log(Σr²/V) is ~pivotal). Module-level fit + residual-quantile
   caches ⇒ models frozen at eval start, same semantics as Log-HAR.
   One port-time fix: `unpack()`'s return type
   `GarchFit["omega"|…|] & {hard,soft}` collapses to `number & {…}` under
   strict tsc — replaced with a named `UnpackedParams` interface.
2. **`lib/tsfm-lab/design.ts`** — `"garch" | "gjr" | "egarch"` added to the
   `ModelId` union; three `ModelSpec` entries (vol-lane only) describing each
   variant and the literature it mirrors; `vol` target blurb now names the family.
3. **`lib/tsfm-lab/models.ts`** — `import { garchArm } from "./garch"`;
   `GARCH_SPECS` map + early-return branch in `armPredict` **before** the switch
   (the family is the only arm whose closure honors per-call `(T, h)` — the fan
   widens with the aggregate-variance path); header comment updated.
4. **`lib/tsfm-lab/models.ts` (bug fix carried from the lab, Task 53 there)** —
   `makeVolTargets.rvH` guard `cnt < Math.max(2, ⌊h/3⌋)` →
   `cnt < Math.min(h, Math.max(2, ⌊h/3⌋))`. At h=1 the window holds exactly one
   return, so the old guard made EVERY h=1 vol target NaN (empty H=1 fits for
   all vol arms, NaN fan heads). h ≥ 6 behavior is unchanged (min(h, ·) = ·).
5. **`lib/tsfm-lab/eval.ts`** — `modelsFor("vol")` now
   `["ewma","garch","gjr","egarch","svol","har","tsfm_base","tsfm","timestral"]`.
   Price/direction lanes untouched. `evaluate()`/`runArm` pick the arms up
   automatically; `barFor("vol")` stays `har`.
6. **`app/api/tsfm-lab/forecast/route.ts`** — MODELS allowlist gains the 3 ids.
7. **`components/tsfm-lab/verdict-grid.tsx`** — the verdict grid is now **five
   gates**: new `garch-family` gate (BTCUSD · vol · 24h) rendering the three
   family arms vs the Log-HAR bar in a daisyUI/native table (ratio · DM p ·
   cov80), a DISPLACES / NO DISPLACEMENT badge (displaces = ratio < 1 AND
   DM p < 0.05), a TSFM-class contrast stat, and window-agnostic honest copy.
8. **`app/dashboard/tsfm-lab/page.tsx` + `components/tsfm-lab/design-spec.tsx`**
   — "four gates" → "five gates"; layered-verdict gains the measured GARCH item
   (this repo's own numbers, see below); design-spec lane paragraph names the
   family so "should I just use GARCH?" stays a number, not an opinion.
9. **`scripts/tsfm-lab-garch-sanity.ts` + `scripts/tsfm-lab-vol-eval.ts` (new)**
   — reproduction tools (run with `bun` from the repo root).

The model-arm dropdown needed **no** change: it already filters by
`m.targets.includes(target)`, so the family appears only on the vol lane.

## Measured on this repo's own data window (5 symbols, 90 rolling origins)

`bun scripts/tsfm-lab-garch-sanity.ts` — all 15 fits (5 symbols × 3 specs)
converged in 32–765 ms with textbook parameters: BTC α+β ≈ 0.94, USDJPY
persistence ≈ 0.999, ν ≈ 3.5–5.8 (heavy tails everywhere), in-sample one-step
95% coverage 0.945–0.957, and AIC ordering EGARCH-t < GJR-t ≪ GARCH-N on every
symbol (tails pay more than asymmetry).

`bun scripts/tsfm-lab-vol-eval.ts` — DM vs Log-HAR, ratio < 1 = better:

- **BTCUSD 24h (the gate):** GARCH 0.990 / GJR 0.995 / EGARCH 1.000, all
  DM p > 0.84 → **no displacement** (the gate card shows NO DISPLACEMENT).
- **USDCHF 72h:** the ONE significant displacement — whole family ≈ 0.84
  (GARCH p=0.0074, GJR p=0.0062, EGARCH p=0.0060). This **replicates the
  sibling lab's finding** (≈0.89 there) on an independent window: GARCH's
  robust lane is long-horizon low-vol FX.
- **XAGUSD 24h/72h:** family significantly WORSE (1.54–1.98, p < 0.001) —
  silver's spiky vol is a Log-HAR stronghold.
- BTCUSD 6h: family 0.95–0.97 ns; USDJPY: 0.94–1.03 ns everywhere;
  XAUUSD 72h: family ≈ 1.30 significantly worse.
- Net: 3/45 family cells significantly better, 8/45 significantly worse,
  Log-HAR keeps the bar. Lane-specialist pattern, not a general winner.

## Verification

- `tsc --noEmit` — clean (after the `UnpackedParams` fix).
- `npm run lint` — 0 errors (14 pre-existing react-hooks warnings, none in
  touched files).
- API E2E (dev server :3010): POST `/api/tsfm-lab/forecast` with
  model=egarch/garch/gjr, target=vol → monotone, all-finite fans; egarch local
  pinball 0.12044 **byte-matches** the eval-table value; H=1 vol fans are
  finite (the rvH fix works); GET `/api/tsfm-lab/eval?series=BTCUSD&target=vol&horizon=24`
  → 200 in ~1 s with all family rows (the worklog's ">420 s eval hang" did
  NOT reproduce on this window/machine); overview lists 10 models.
- Browser E2E (agent-browser on /dashboard/tsfm-lab): zero page errors;
  verdict section = five gates with the GARCH card rendering NO DISPLACEMENT
  + the family table; vol-target model dropdown offers all 9 vol-native arms;
  selecting EGARCH renders its own orange fan + diagnostics card
  (pinball 0.1204, cov80 74%, 89 origins); evidence table shows all 8 sync
  arms with Log-HAR marked "(bar)"; mobile 390 px has no horizontal overflow.

## Sandbox-only artifacts (NOT in the shipped diff)

- `npm ci` was required (no node_modules in the clone).
- Clerk keys are absent in the sandbox; the root layout's `ClerkProvider`
  throws at module scope without them, 500-ing every route. Verification ran
  with a gitignored `.env.local` (format-valid placeholder keys) and a
  **temporary** stub of `proxy.js`'s `clerkMiddleware` (reverted byte-for-byte
  after E2E; `proxy.js` is identical to HEAD). With real keys none of this is
  needed; the browser console Clerk errors seen during E2E are the same
  placeholder-key artifact.
- `lib/tsfm-lab/eval/route`'s covImportance/pitHistogram still lack the
  ablation's stride-3 subsampling (documented blocker in
  `worklog-tsfm-lab-volatility-investigation.md`) — measured here at ~1 s/cell,
  so it did not block this work.

## Numbers caveat

The CSVs here (5000 bars ending 2026-10-26) differ from the sibling lab's
window, so numbers are NOT cross-comparable — but the family's qualitative
verdict (no general displacement; one robust FX long-horizon win) replicated.
Gate-card copy is deliberately window-agnostic; the layered-verdict item on
the page carries this window's numbers and says so.

## Sibling parity

The same latent `unpack()` type bug existed in the sibling lab's
`src/lib/tsfm/garch.ts` (21 tsc errors, masked because that repo's gate is
lint). Fixed there too, and `external/` added to the sibling's tsconfig
exclude so vendored clones stop polluting its repo-wide tsc.

## Addendum — lane guard at the API boundary (merged post-E2E, pre-commit)

A second pass re-derived the port independently from a fresh origin clone and
confirmed the five core wiring sites, then merged one addition into this tree:
`app/api/tsfm-lab/forecast/route.ts` now validates **model ↔ target lane
membership** (`MODEL_LANES`, single-sourced from `design.ts::MODELS`) instead
of the flat model allowlist. The flat allowlist accepted any model in any
lane — e.g. `{model:"garch", target:"price"}` (or the pre-existing
`{model:"har", target:"price"}`) would have run a vol-only arm in the price
lane and returned a garbage-but-200 fan. The guard is a no-op for the UI (the
dropdown already filters by `targets`) and adds a fourth enforcement point for
the family's vol-lane-only rule, after `design.ts` targets, `modelsFor("vol")`,
and the `armPredict` dispatch itself. Re-verified after the merge:
`tsc --noEmit` 0 errors · `eslint` 0 errors on touched files · guard logic
spot-checked against `MODELS` (garch→{vol}, naive→{price,direction},
unknown id→400 path).

The work was then committed locally (two commits: the GARCH family port incl.
scripts and this worklog; the previously-uncommitted
`docs/worklog-kairos-claims.md` companion doc separately). **Not pushed** —
the push gate stays with the operator per AGENTS.md.
