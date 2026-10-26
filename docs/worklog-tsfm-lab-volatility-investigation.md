# Worklog — TSFM Lab: volatility-predictor investigation + lab maintenance

> **Date:** 2026-10-25 · **Repo role:** `nobletradingapp` — research lab (dashboard + harness + sidecar)
> **Build code:** authorized ("document these next steps") · **Gate:** none changed — this doc only
> **Lab page:** `app/dashboard/tsfm-lab` · **Companion harness:** `lib/tsfm-lab/`
> **Related:** `docs/worklog-kairos-frontend-harmonization.md` (the edge-lab port this mirrors),
> `noble-trader-fastapi-backend/worklog/` (Kairos build logs)

---

## 0. What this document is for

Two jobs, kept separate:

1. **Track the investigation** — six ordered next steps whose goal is one question:
   *can a time-series foundation model (Timestral) predict realized volatility?*
2. **Record how to run, maintain and (if warranted) train the lab** — so the lab is operable
   without re-deriving the wiring each time.

Read **§4 (Investigation)** before touching the model. Read **§2 (Lab anatomy)** and
**§3 (Maintenance runbook)** before running anything. **§6** is the interpretation
framework — it tells you what each result *means*, which is where most of the value is.

---

## 1. The question, and why the vol lane specifically

Timestral is a **zero-shot foundation model** for time-series forecasting (patch-based
transformer, 8 layers, emb 192, patch 32, 21 quantiles). It is asked three lanes:

| Lane | Target | Bar to beat | Status |
|---|---|---|---|
| `price` | log close at T+H | random walk (`naive`) | running — the market-efficiency null |
| `direction` | P(close↑) from the fan's CDF | coin flip (Brier 0.25) | running — the market-efficiency null |
| **`vol`** | **log RV over the next H hours** | **Log-HAR** | **the one under test** |

The price and direction lanes are *deliberately* expected to be near-zero-skill — finance is
the domain where climatology does **not** transfer, so those two lanes are the null that makes
a vol win meaningful. Keep them running as-is; do not read them as failures.

Vol is the interesting lane because volatility has the two properties that make a
forecaster plausible: it **clusters** (GARCH/HAR dynamics) and it has **intraday
seasonality** (the U-shape). The weather intuition is least wrong here.

**How the vol target is actually defined** (`lib/tsfm-lab/models.ts::makeVolTargets`):

```
y(i,H) = 0.5 · log( mean( r² )  over bars (i, i+H] )      r = hourly log-return
```

Note the `0.5·log` — the target is a **log** realized-vol (a "log RV"), which is why the
harness calls it `log RV` and why `TARGET_META.vol.unit` is `"log RV"`. This is QLIKE-shaped
and robust to near-zero vol; it is **not** the level of σ.

---

## 2. Lab anatomy — the parts you must know to maintain it

```
nobletradingapp/
├── app/dashboard/tsfm-lab/page.tsx          the lab UI (daisyUI)
├── app/api/tsfm-lab/{forecast,eval,overview}/route.ts
├── lib/tsfm-lab/
│   ├── design.ts     protocol constants (EVAL), lanes, τ grid, API contract
│   ├── data.ts       price CSV / R2 read + all covariate derivation + regime labels
│   ├── models.ts     arms (naive/HAR/EWMA/ridge stand-ins), features, losses, DM test
│   ├── sidecar.ts    the REAL Timestral client (HTTP :3030) + ablation shuffles
│   ├── eval.ts       rolling-origin evaluator → MetricRow[]
│   └── harness.ts    evaluate() orchestrator (the /eval payload)
├── components/tsfm-lab/{fan-chart,covariate-panel,eval-section,verdict-grid,design-spec}.tsx
├── data/tsfm/{SYM}.csv            5 × 5000-bar TDVA hourly OHLCV (local copy)
└── mini-services/
    ├── tsfm-sidecar/server.py     Timestral-5M inference (FastAPI :3030)
    └── tsfm-r2-worker/            Cloudflare Worker bridging the private R2 bucket
```

### 2.1 The eval protocol (`design.ts::EVAL`)

| constant | value | meaning |
|---|---|---|
| `originDays` | 90 | rolling origins over the final 90 days |
| `originStrideHours` | 24 | one origin per day → **90 origins** |
| `embargoBars` | 72 | purge between train end and the first origin (= max horizon) |
| `frozen` | true | models frozen at eval start — **zero-shot semantics** |
| `crpsFactor` | 2 | CRPS ≈ 2 × mean pinball over the 7-τ grid |

τ grid (`QUANTILES`) = `[0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]` (7 knots).
Horizons = `HORIZONS = [1, 6, 24, 72]`.

**Critical sizing rule.** With N bars:

```
trainEnd = N − 90×24 − 72 = N − 2232
```

If `trainEnd ≤ 0` the train segment is empty, the regime threshold `eps` degrades to
`Infinity`, and **every bar is labeled neutral** — a silent, valid-looking failure. The
committed CSVs are 5000 bars → `trainEnd = 2768` ✓. A 2160-bar window gives `-72` ✗.
**Never let the price window drop below ~2300 bars.**

### 2.2 The arms (vol lane)

`modelsFor("vol")` = `["ewma", "svol", "har", "tsfm_base", "tsfm", "timestral"]`

| arm | what it is |
|---|---|
| `ewma` | EWMA(λ=0.94) baseline |
| `svol` | previous-window RV (persistence) |
| **`har`** | **Log-HAR — the bar to beat** (`barFor("vol")`) |
| `tsfm_base` | ridge stand-in, univariate only (`target_lag`) |
| `tsfm` | ridge stand-in, full covariates (offline proxy) |
| **`timestral`** | **the real Timestral-5M, zero-shot, via :3030** |

`MetricRow` (what `/eval` returns per arm) carries `pinball`, `crps`, `cov50/80/90`,
`width80`, `dmZ`, `dmP`, `skillRatio` (= pinball / bar pinball, **< 1 = better**), and
for direction `brier`/`acc`.

### 2.3 The covariates (17 channels) — this is step 3's raw material

`COV_KEYS` = `target_lag` (always on) + 16 toggles:

| role | keys |
|---|---|
| **past-only / numeric** | `rv24`, `rv72`, `atr`, `ewma`, `volz`, `drawdown`, `rsi`, `lag_ret`, `trend`, `shift` |
| **categorical** | `regime` |
| **known-future (calendar)** | `hour`, `dow`, `session`, `month_end`, `opex` |

The known-future keys expand to sub-channels (`calendarNamesFor`): `hour` →
`hour_s1, hour_c1, hour_s2, hour_c2` (sin/cos harmonics); `dow` → `dow_num, weekend`;
`session` → `sess_london, sess_ny`; plus `month_end`, `opex`.

The **full-conditioning** arm (`fullCovKeys`) is `target_lag, trend, regime, hour, dow,
session, month_end, opex` + `{atr, ewma, shift}` for the vol lane. Note `rv24`/`rv72` are
**excluded** from the vol lane's full set — they are the price lane's vol features.

> **Circular-dependency trap (read before trusting the vol lane's covariate ablation).**
> `rv24`/`rv72` are built from the same hourly log-returns that define the vol target
> `y(i,H)`. On the **price** lane this is legitimate (predicting the level from past vol is
> real conditioning). On the **vol** lane it is the target's own ingredient — including it
> is leakage-adjacent. The harness's `fullCovKeys` happens to exclude them for vol, but
> `covImportance` runs `tsfm` (the ridge stand-in) over the same key set, so step 3's
> attribution must be read with this in mind. Flag it before building any claim on it.

### 2.4 The sidecar contract (`mini-services/tsfm-sidecar`)

| | |
|---|---|
| `GET /health` | `{status, model, params, taus[21], supports_covariates, supports_known_covariates}` |
| `POST /forecast` | body `{target[T], pastCovariates[][T], pastNames[], futureCovariates[][H]\|null, futureNames[]\|null, horizon}` → `{taus[21], quantiles[H][21]}` |

Covariate routing: `regime` → `categorical_past_covariates`; other past rows →
`past_covariates`; each `futureNames` row is **joined with its same-named past history row**
and sent as `known_covariates` over `T+H`. `clip_nonnegative=False` because the price lane
works in log units. **A future channel sent without its matching history row is structurally
invalid — the sidecar 400s rather than feeding NaNs.**

Env: `TSFM_MODEL_ID` (default `mistralai/Timestral-5M`), `TSFM_HOST`/`TSFM_PORT` (`127.0.0.1`/`3030`),
`TSFM_MAX_CONTEXT` (4096), `HF_HOME` (weights cache).

Measured: cold load ~8 s, warm **~118 ms**/forecast, 5,208,960 params, ~100 MB RSS, CPU-only.

### 2.5 The price source (R2)

`data.ts::readSource` fetches `${TSFM_R2_URL}/${TSFM_R2_PREFIX}/${SYM}.csv` into a TTL cache
(`TSFM_R2_TTL_MS`, 300 s) and **falls back to `data/tsfm/*.csv`** unless `TSFM_R2_FALLBACK=0`.

| var | value |
|---|---|
| `TSFM_R2_URL` | `https://nt-tsfm-data.lexington.workers.dev` (Worker) or the public/custom R2 URL |
| `TSFM_R2_PREFIX` | `tsfm` |
| bucket | `nt-tsfm-prices` → `tsfm/{SYM}.csv` |

**A 200 does not prove R2 served the request** — the fallback returns the same bytes from
disk. The confirming check is the dev log: a successful R2 read produces **zero**
`using local data/tsfm/ copy` warnings.

---

## 3. Maintenance runbook

### 3.1 Start the stack (local)

```bash
# 1. sidecar FIRST (model load is 30–60 s warm)
cd nobletradingapp
uv venv --python 3.12 && uv pip install -r mini-services/tsfm-sidecar/requirements.txt
export HF_HOME=/path/to/hf/cache            # where mistralai/Timestral-5M lives
python mini-services/tsfm-sidecar/server.py     # :3030

# 2. dev server
npx next dev --port 3300                   # use localhost, NOT 127.0.0.1 (see §3.5)
```

Verify: `curl -s http://127.0.0.1:3030/health` → `status:"ok"`, `params:5208960`, 21 τ.

### 3.2 Refresh the price window (the routine task)

```bash
# backend repo — TDVA, full 5000-bar window
cd ../noble-trader-fastapi-backend
./.venv/Scripts/python.exe scripts/export_edge_lab_data.py \
  --source tdva --symbols BTCUSD XAUUSD XAGUSD USDJPY USDCHF \
  --hours 5000 --data-dir <dir> --force
```

Then copy the 5 CSVs into `nobletradingapp/data/tsfm/` **and** push to R2:

```bash
cd ../nobletradingapp
for S in BTCUSD XAUUSD XAGUSD USDJPY USDCHF; do
  npx --yes wrangler@latest r2 object put "nt-tsfm-prices/tsfm/$S.csv" \
    --file "data/tsfm/$S.csv" --remote
done
```

> **`--remote` is mandatory.** `wrangler r2 object` defaults to `--local` (wrangler's mock
> state in `.wrangler/state`). Without `--remote` the upload never reaches the bucket — and
> an md5 "round-trip" against the same mock passes, so it looks verified while the bucket is
> empty. This already bit once.

Verify the remote copy independently:

```bash
npx --yes wrangler@latest r2 object get "nt-tsfm-prices/tsfm/BTCUSD.csv" --remote \
  --file "$TMPDIR/rt_BTCUSD.csv"
md5sum data/tsfm/BTCUSD.csv "$TMPDIR/rt_BTCUSD.csv"   # must match
```

### 3.3 Verify a run is real (not the fallback)

Hit `/api/tsfm-lab/forecast?series=BTCUSD&target=vol&horizon=24` and check the dev log for
`using local data/tsfm/ copy`. **Zero warnings = R2 served it.**

### 3.4 The eval endpoint (the investigation's workhorse)

```
GET /api/tsfm-lab/eval?series=BTCUSD&target=vol&horizon=24
```

`series ∈ {BTCUSD, USDJPY, USDCHF, XAUUSD, XAGUSD}` · `target ∈ {price, vol, direction}` ·
`horizon ∈ {1, 6, 24, 72}`. Route: `app/api/tsfm-lab/eval/route.ts`.

Response (`EvalResponse`): `rows[]` (one `MetricRow` per arm), `bar`, `pit`, `pitBase`,
`pitTimestral`, `ablation{shufflePast,shuffleKnown}`, `timestral{available,note}`,
`verdict{gate,passed,detail}`, `n` (origins, ≤ 90).

The verdict gate for vol/price is: **`skillRatio < 1` AND `dmP < 0.05`** → `passed:true`;
ratio < 1 but p ≥ 0.05 → `passed:null` ("point estimate better, not significant — treat as
unproven"); ratio ≥ 1 → `passed:false`.

### 3.5 Known traps (each has cost a session)

| trap | symptom | fix |
|---|---|---|
| `allowedDevOrigins` lacks `127.0.0.1` | page renders, chart stuck on skeleton forever, no error | use `http://localhost:PORT`; add `127.0.0.1` if IP access is needed |
| Stale dev server holds the port | a "fix" appears to do nothing | kill every listener (`netstat -ano \| grep ':PORT' \| grep LISTENING` → `taskkill /PID <pid> /F`) before restarting |
| Harness caches series at module level | a swapped CSV is invisible until restart | restart `next dev` after replacing `data/tsfm/*.csv` |
| `next build` type-checks the whole repo | an unrelated failure looks like a port regression | gate on `tsc --noEmit` + `next lint` on the lab tree |
| `tsconfig.json` blanket include | ~87 `Cannot find module` in `supabase/` | `"exclude": ["node_modules", "supabase"]` (Deno Edge Functions are not Next code) |
| **`/eval` hang** | empty verdict grid | **OPEN** — see §5 |

---

## 4. Investigation — six ordered next steps

> **Rule for every step:** one lever at a time, and record the cell, the number, and the
> DM p. A pooled number hides the cells that carry it (the repo's own rule from
> `vol-backtest-framework.md`).

### Step 1 — Replicate before you believe  *(do this first)*

**Claim under test:** Timestral beats Log-HAR on the vol lane.

**Starting evidence:** one PASS cell (BTCUSD vol H=24) and one tie (XAUUSD). That is
**single-symbol evidence and is not evidence yet.**

**Action:** run the vol lane across all 5 symbols × H ∈ {1, 6, 24, 72} → a **20-cell
matrix** of `skillRatio` + `dmP`, all through `/api/tsfm-lab/eval`.

```bash
for S in BTCUSD XAUUSD XAGUSD USDJPY USDCHF; do
  for H in 1 6 24 72; do
    curl -s "http://localhost:3300/api/tsfm-lab/eval?series=$S&target=vol&horizon=$H" \
      -o "$TMPDIR/eval_${S}_${H}.json"
  done
done
```

Then reduce each to the two numbers that matter (`rows[model=timestral].skillRatio` /
`dmP`) and lay them out as a 5×4 grid.

**Interpretation (§6.1):**
- win holds on **most cells** → a **class property** of TSFM on vol.
- win is **BTCUSD-only** → a **crypto-vol quirk**, not a class property.
- win is **scattered** → look at which asset class before concluding.

**Cost warning:** `/eval` is expensive (90 origins × 4 sidecar calls + 2 ablations + PIT
+ importance). Expect **minutes per cell**; 20 cells sequentially is a long run. Cache
hits make repeat calls instant (`evalCache`).

### Step 2 — Decompose the edge by quantile

**Question:** does the win live in the **median** (τ=0.5) or the **tails** (τ=0.05/0.95)?

**Why it matters:** the actual use case for vol forecasts is **risk sizing**, and risk
sizing lives in the tails. A median-only win is much less actionable.

**Gap to close first:** the harness currently reports **one pooled pinball** (mean over the
7 τ). `MetricRow` has **no per-τ breakdown**, and `runTimestralArm` already computes
`qvecs` per origin (the per-origin 7-τ vectors) but only uses them for the PIT histogram —
**it discards them before returning.** So step 2 needs a small harness addition: accumulate
per-τ pinball alongside the pooled loss (the `lossOf`/`pinball` helpers already exist).

**Corollary — coverage is already per-interval.** `MetricRow` carries `cov50`/`cov80`/`cov90`
(the empirical coverage of the 50/80/90% intervals) and `width80`. A **low tail coverage**
(e.g. cov90 ≈ 0.33 against a 0.90 target, as seen in the lab's price-lane readout) means the
fan is **too narrow** — which independently says the tails are under-predicted even before
pinball is split. Check `cov90` on the vol lane as a zero-cost pre-read of step 2's answer.

**Read:** a win concentrated at τ=0.5 with flat tails → the model predicts the *level* of
vol well but not its *spread*. A win at the tails → genuinely useful for sizing.

### Step 3 — Attribute the rent

**Known:** covariates pay **+9.9%** CRPS on the price lane (the `verdict.detail` reports
"Covariates buy +X% vs the univariate stand-in"). **Find out which channels.**

Candidates and what each would mean:

| if the rent is mostly… | then… |
|---|---|
| `hour` / `dow` / `session` (calendar harmonics) | the model is exploiting the **intraday U-shape** — real but bounded |
| `atr` / `ewma` / `shift` | genuine **vol-clustering regression** — a stronger claim |
| `regime` / `trend` | it is reading the same price slope that defines the label — **circular** |

**Existing machinery:** `covImportance()` (`eval.ts`) is a leave-one-covariate-out
ablation over the `tsfm` ridge stand-in, exposed via `importanceFor`. The sidecar arm has
its own `ablation{shufflePast,shuffleKnown}` ("wrong values, right distribution").

**But** `covImportance` runs the **stand-in**, not Timestral — so first decide whether the
stand-in's channel ranking transfers, and read §2.3's circular-dependency trap before
building any claim on the vol lane's ablation.

### Step 4 — Size ladder

**Action:** swap `Timestral-28M` / `123M` / `209M` weights into the same sidecar (same
contract, different weights dir) and re-run the vol lane.

```bash
export TSFM_MODEL_ID=mistralai/Timestral-28M   # then 123M, then 209M
python mini-services/tsfm-sidecar/server.py
```

**Reference points (GIFT-Eval CRPS, lower = better):** 5M 0.479 · 28M 0.461 · 123M 0.448 ·
209M 0.446. Skill improves with parameters but with **diminishing returns** (~4% from 5M→28M,
~3% from 28M→123M, ~0.4% from 123M→209M). Note 209M is ~837 MB of weights and CPU-feasible
but 1–2 s/call.

**Why it matters:** it separates "**5M is small**" from "**the class is weak**". If skill
scales, the 5M result is a **lower bound**; if it does not, the 5M result is already the
class ceiling and the question is settled cheaply.

### Step 5 — Fine-tuned arm

**Action:** 5.2M params fine-tunes in minutes on CPU. Train on the **first 80%** of each
symbol with the covariate channels; eval **frozen on the last 20%**.

**Why:** zero-shot vs fine-tuned is the **explicit headroom measurement**. If fine-tuning
adds **>10% CRPS**, the zero-shot number **understates the class** — and the whole
zero-shot conclusion is a floor, not a verdict.

**Design constraint:** the split must be **chronological** (80/20), never random, and the
fine-tune window must not overlap the eval window or the embargo — otherwise it is
in-sample. The harness's `EVAL.frozen: true` exists precisely to prevent this.

### Step 6 — Translate to the thing traders pay for

**Action:** vol-lane skill = **position sizing**. Feed the Timestral fan into a
**vol-targeted sizer** and a **HAR-driven sizer** on **identical signals**, and measure
**realized vol-targeting error**.

**Why:** this converts "beats HAR on CRPS" into "beats HAR on **utility**" — and it scores
forecasts **without building a strategy**. It is the only step that answers "so what".

**Method note:** use the fan's **interquantile spread**, never the median path — a level
path's median carries no variance (`sum(diff(log(median))²) ≈ 0`). Convert via
`σ_step = (q90 − q10) / (2 · z₀.₉)`. Getting this wrong yields a garbage arm that still
"looks" valid (the repo measured QLIKE ~500 from exactly this mistake).

---

## 5. Open blocker — `/api/tsfm-lab/eval` hangs

**Status: OPEN, and it blocks step 1.**

The eval route was observed hanging past **420 s**, which is why the verdict grid renders
empty (the "missing data" the user reported). `maxDuration = 120` on the route will also
kill it on a hosted tier.

**Why it is slow:** `evaluate()` is not a single forecast. Per call it runs:
90 origins × (1 sidecar forecast + 2 ablation arms at stride 3) + 2 PIT histograms +
`covImportance` (one leave-one-out re-run per covariate, ~16 arms). That is on the order of
**hundreds of sidecar round-trips**, each ~118 ms, plus the 4-way parallel pool and the
`qCache`/`importanceCache` maps.

**Fix options, in order of preference:**
1. **Subsample the origins for the ablation/importance paths** (they are diagnostics — the
   stride-3 subsampling already exists for `ablation`; `covImportance` and `pitHistogram`
   do not use it).
2. **Persist the eval matrix** (the 20 cells of step 1) to a JSON/CSV in the workspace and
   read it back, rather than re-deriving it per request.
3. **Move `/eval` off the request path** — run it as a script and publish the artifact, the
   same pattern the edge-lab uses for its audit.

Until then, run step 1's 20 cells **off the HTTP path** (script it, or run the cells one at
a time and tolerate the minutes-per-cell cost).

---

## 6. How to read the results — the interpretation framework

### 6.1 The three possible verdicts

| outcome | what it means | next move |
|---|---|---|
| **Win holds on most cells** | a **class property** — TSFM genuinely predicts vol better than HAR | proceed to steps 2–6; this is the interesting branch |
| **Win is BTCUSD-only** | a **crypto-vol quirk** — do not generalize | narrow the claim; test whether it is the 24/7 calendar |
| **No win anywhere** | TSFM is not a vol predictor here | the price/direction nulls already suggested this; stop, and record it |

### 6.2 What would *falsify* the claim

- The win disappears when `hour`/`dow`/`session` are removed (→ it was the U-shape, not
  vol dynamics).
- The win disappears under the **fine-tuned** arm (→ zero-shot was carrying it by accident).
- The win does not scale across the **size ladder** (→ it is a 5M artifact).
- The win does not transfer to **vol-targeting error** (→ CRPS skill ≠ utility; step 6).

### 6.3 What would *strengthen* the claim

- The win survives leave-one-covariate-out and concentrates in `atr`/`ewma`/`shift`
  (genuine clustering regression).
- The win **scales** across 28M/123M/209M (a class property, and 5M is a lower bound).
- Fine-tuning adds **>10%** CRPS (the zero-shot number understates the class).
- The win shows up in **tail pinball** (τ=0.05/0.95), not just the median.
- Timestral's sizer beats HAR's on **realized vol-targeting error** (step 6).

### 6.4 Standing discipline (from the repo's evidence rules)

- **Report per-cell, never pooled.** BTC's ~5× vol scale dominates any raw-scale pool.
- **Always report DM p alongside the ratio.** `skillRatio < 1` with `p ≥ 0.05` is
  "unproven", not a win.
- **Never score an arm on a series reconstructed from its own target** — the vol lane's
  target is derived from the same returns that define `rv24`/`rv72` (§2.3).
- **Vol comes from the quantile spread, never the median path.**
- **One lever at a time.** Steps 1→6 are ordered for a reason; running two at once makes
  the result uninterpretable.

---

## 7. Decision log

| date | decision | why |
|---|---|---|
| 2026-10-25 | hourly bars kept as design | user preference; the model is conditioned on hourly bars |
| 2026-10-25 | regime labels kept but **demoted** to "input covariate, not forecast" | they read as a prediction; they are conditioning context |
| 2026-10-25 | price/direction lanes kept running | they are the market-efficiency null that makes a vol win meaningful |
| 2026-10-25 | investigation ordered 1→6 | replication before decomposition before attribution |

### Where the current evidence actually came from

The six steps above are the *forward* plan; the starting evidence is weaker than it sounds,
so record the provenance honestly:

- The **one PASS cell + one tie** that step 1 asks to replicate came from the lab's own
  `/eval` verdict gate (`skillRatio < 1 ∧ dmP < 0.05`) — a **single (symbol, horizon) cell
  at a time**. That is exactly why step 1 is first.
- The **"+9.9% covariates pay"** figure that step 3 builds on is the price lane's
  `verdict.detail` ("Covariates buy +X% vs the univariate stand-in"), computed against the
  **ridge stand-in (`tsfm`)**, **not** Timestral. Treat it as a stand-in result until step 3
  re-measures it on the real model.
- An **earlier, independent** Timestral-as-RV-arm measurement (backend `regime_edge/tsfm.py`
  lineage, QLIKE vs HAR) came out **worse than HAR** on BTC/XAG/XAU and n.s. on USDCHF/USDJPY.
  It used a different harness and a different vol conversion (interquantile spread in return
  units), so it is **not** directly comparable to the lab's CRPS-ratio — but it is a prior
  that says the vol claim is not free. Read step 1 as a genuine test, not a formality.

---

## 8. Glossary

| term | meaning |
|---|---|
| **RV** | realized volatility — here `0.5·log(mean(r²))` over an H-hour window (a *log* RV) |
| **Log-HAR** | the bar to beat on the vol lane: log-realized-vol regressed on its own lags (daily/weekly/monthly analogue) |
| **CRPS** | continuous ranked probability score; the harness approximates it as `2 × mean pinball` over the 7-τ grid |
| **pinball** | quantile loss; the proper scoring rule for a quantile forecast |
| **DM test** | Diebold–Mariano, with Newey–West variance — tests whether two arms' loss difference is significant |
| **PIT** | probability integral transform; a 20-bin histogram of where the realized value falls in the forecast CDF. Flat = calibrated |
| **skillRatio** | arm pinball ÷ bar pinball; **< 1 = better than the bar** |
| **origin** | a rolling backtest cutoff; 90 of them, one per day over the final 90 days |
| **embargo** | the 72-bar purge between train end and the first origin, preventing look-ahead |
| **τ** | quantile level; the harness uses 7 knots (0.05…0.95) |
| **ablation** | "wrong values, right distribution" — circularly shifting a covariate block to test whether the model reads it |
