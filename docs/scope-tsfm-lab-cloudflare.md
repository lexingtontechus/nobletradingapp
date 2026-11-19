# Scope: TSFM Lab on Cloudflare — hosting verdict + R2-authoritative data redesign

> **Date:** 2026-11-18 · **REVISED same day:** the §4 refresh design is superseded —
> the `tsfm-refresh` cron Worker is **RETIRED (never built)** as duplicated price-fetching
> workload. The refresh is now an hourly job in `noble-trader-fastapi-backend` reusing
> the sweep's own TDVA client: see
> `noble-trader-fastapi-backend/docs/scopes/20261118_TSFM_R2_BACKEND_PUBLISH_SCOPE.md`
> (authoritative for the writer side; this doc remains authoritative for hosting + reads).
> **Ask:** (1) Can the lab's server functions run on a Cloudflare Worker?
> (2) Can `nobletradingapp-backend` move to Cloudflare? (3) Prod reads bundled
> CSVs, not R2 — redesign the data layer.
> **Answers:** (1) **YES on Workers Paid ($5/mo)** — measured fit below; free plan
> is impossible (10 ms CPU). (2) **Not as-is** (FastAPI ≠ Workers); **YES via
> Cloudflare Containers** lift-and-shift — sequenced later, not now. (3) R2 becomes
> the only prod source (binding, no file fallback exists in an isolate) **plus an
> hourly backend-owned TDVA→R2 publish job** — because the R2 copy is the SAME
> stale vintage as the bundled files (both end 2026-10-26; 23 days old at writing).
> **Supersedes** the harness-hosting decision (B1, Render co-deploy) in
> `nobletradingapp-backend/docs/SCOPE-tsfm-lab-hosting.md` — new measurements +
> the Workers option change the verdict. The backend-stays-on-Render part of that
> doc stands. Frontend proxy contract: `docs/scope-tsfm-lab-hosting.md` (amended).

---

## 0. Plain language

The lab's math is a self-contained TypeScript program with no library dependencies.
Cloudflare Workers run exactly this kind of program, instantly, next to the R2
bucket that already holds the lab's price data — but only on the $5/month paid
plan, because the free plan allows 10 milliseconds of computing per request and
one lab evaluation takes 3.3 seconds. Measurements below show the program fits
the paid plan's memory and time limits with room to spare.

The Python analytics backend is a different animal: Workers cannot run a Python
web server. Cloudflare's container product can run it unchanged, but moving it is
a separate step — do one move at a time.

The data problem is worse than "prod reads files": the R2 copies are the same
October 26 snapshot, so even flipping prod to R2 today would serve 23-day-old
prices silently. The fix is an hourly job in the trading backend — which already
fetches TDVA prices for the sweep every 15 minutes — publishing the five lab CSVs
to R2 through the existing bridge Worker, plus a vintage stamp on every lab
response so stale data is always visible. (The first draft of this scope gave the
refresh to a new Cloudflare cron Worker; that duplicated the backend's fetching
workload and was retired the same day — one fetch implementation, not two.)

## 1. Measured fit (probes run 2026-11-18, Node v22.23.2, live R2 feed)

| Quantity | Measured | Workers limit (docs, Nov 13 2026) | Verdict |
|---|---|---|---|
| Live data set, post-GC (all 5 series + 8 eval cells) | heapUsed 16.6 MB + external 12.8 MB ≈ **30 MB** | 128 MB per isolate (heap + WASM + buffers) | **fits, ~4× headroom** |
| Peak heapTotal + external | ≈ 65 MB | 128 MB | fits |
| Process RSS | ~121 MB | — | Node runtime overhead, NOT isolate payload — the 128 MB cap applies to the V8 isolate, which the heap numbers above bound |
| esbuild bundle (harness + all 8 modules, fs/path external) | **76,301 bytes** | 64 MiB uncompressed | trivial |
| Cold `evaluate` vol cell CPU (8 arms × 89 origins) | **3.30 s** | Paid: 30 s default, configurable to 300 s. Free: 10 ms | **fits paid**; free impossible |
| Cold series derivation (`overview`) | 0.65 s CPU | same | fits paid |
| Real-arm eval subrequests (sidecar up) | ~135–179 fetches | 10,000/request paid; 6 concurrent connections | fits (client is sequential per origin) |
| Isolate startup | — | < 1 s (typically ms); **no spin-down** | vs Render free ~1 min spin-up after 15 min idle |

Network waits (sidecar HTTP, R2 reads) do **not** count against Workers CPU time —
the same distinction that killed Supabase Edge (2 s CPU hard cap) does not apply
here: 30 s default is 15× the measured cold eval.

Account state (CF API probe with the repo's `CF_API_TOKEN`): deployed workers =
`nobletradingapp` (identified: the **embeddings proxy**, matches `CF_EMBEDDINGS_URL`;
header says "Free-tier") and `nt-tsfm-data` (the R2 bridge). Plan not readable with
this token's scope (403 on subscriptions) → **open item: confirm/upgrade Workers
Paid**. The embeddings worker's free-tier comment suggests the account is on Free
today, so $5/mo is a real new cost — account-wide, covering all workers.

Included paid allotments: 10 M requests + 30 M CPU-ms/month (= 30,000 CPU-seconds
≈ 9,000 cold eval cells); overage $0.30/M requests, $0.02/M CPU-ms. Research usage
is orders of magnitude below.

## 2. Q1 — the harness on a Worker: YES (paid), and it beats the prior B1 decision

**Ports unchanged:** `models.ts`, `garch.ts`, `eval.ts`, `harness.ts`, `design.ts`,
`evalOptions.ts`, `sidecar.ts` — pure TS numerics, zero npm deps, `fetch` /
`AbortSignal.timeout` / LRU Maps all Workers-native. The instrument stays
byte-identical; parity is gated, not hoped.

**Changes required (the whole port):**
1. `data.ts`: make `readSource(file)` injectable. The Worker entry passes an
   **R2-binding reader** (`env.PRICES.get("tsfm/"+file)`); the Node/local adapter
   keeps today's env-driven R2-fetch + file fallback. No `node:fs` in the isolate —
   the silent stale-CSV path is **structurally eliminated**, not configured away.
2. `process.env` reads → Worker env bindings (`TSFM_SIDECAR_URL` as a secret).
3. Entry wrapper: a `fetch` handler routing `/overview`, `/forecast`, `/eval`
   (+ `/batch` per-cell, §6) with the same JSON contracts and today's route
   validation (SERIES/TARGETS/MODEL_LANES/horizon).
4. Auth: shared-secret header (the `X-API-Key` pattern); the Vercel proxy holds it
   server-side, never the browser.
5. **Vintage-keyed caches:** the harness's module-level Maps persist per isolate,
   but the refresh job (§4) shifts the origins grid daily — every `cacheKey` must
   include the R2 manifest's `updated_at`, or a warm isolate serves pre-refresh
   evals. This is a real correctness requirement, not an optimization.

**Why this supersedes B1 (Render co-deploy):**

| | B1 (prior decision) | Worker (this decision) |
|---|---|---|
| Cold start | ~1 min spin-up (Render free, 15 min idle) | ms — isolates never "spin down" |
| Eval latency (free tier) | ~30–60 s estimated (0.1 vCPU) | ~3–10 s expected (fast V8; **estimate — gated at deploy**) |
| Data path | public bridge Worker hop | native R2 binding, same platform |
| Instrument sync | cross-repo pinned vendor + SOURCE.json hash test | **none — the Worker lives in THIS repo** (`mini-services/tsfm-lab-worker/`, sibling of `tsfm-sidecar`/`tsfm-r2-worker`), importing `lib/tsfm-lab` directly |
| Cost | $0 (free, slow) | $5/mo account-wide (confirm plan first) |
| Real-model arm | sidecar co-process, RAM-gated | torch impossible on Workers → Container at Phase 4 (licence-gated, unchanged) |

The cross-repo sync machinery B1 needed disappears entirely — one repo, one
instrument, one deploy (`wrangler deploy`). That is the consolidation the
standing preference asks for: the lab's compute joins its data on Cloudflare.

**Free plan:** 10 ms CPU kills even `overview()` (0.65 s). Not an option.

## 3. Q2 — nobletradingapp-backend on Cloudflare

Measured surface: `webapp.py` 438 + `supabase_client.py` 239 +
`correlation_regime.py` 350 = **1,027 lines, numpy-only numerics** (no scipy/hmmlearn
in the compute path), 4 read-only endpoints + health, Supabase REST reads.

| Path | Verdict | Why |
|---|---|---|
| Workers, as-is | **NO** | FastAPI/uvicorn is an ASGI socket server; Python Workers are Pyodide beta with no server-framework support. Not a port — a rewrite on a beta runtime. |
| **Cloudflare Containers** | **YES, lift-and-shift** | Dockerfile (`python:3.12-slim` + requirements) → `basic` instance (¼ vCPU, 1 GiB — fits the ~150–250 MB estimated process). `sleepAfter='15m'`, front-door Worker proxies to the container; auth/CORS stay in FastAPI unchanged. Billed per 10 ms active; 25 GiB-hrs + 375 vCPU-min included. Always-on basic ≈ $6.5/mo memory + CPU; bursty traffic (6 h cron warm + dashboard reads) → likely $1–4/mo (**estimate**). |
| TS rewrite to a Worker | Feasible, **rejected for now** | ~1 k lines of numerics + REST reads; parity work on a stable service for zero functional gain. |

**Decision: the backend stays on Render until the lab Worker move is proven**
(one lever at a time). The Containers lift-and-shift is the consolidation step
afterwards (Phase 5); `portfolio-analytics-warm` (Supabase edge) only needs its
`WEBAPP_BACKEND_URL` env flipped — no code change. Studio is never a host for the
analytics backend (unavailable till 11-23; 33-day outage precedent).

**Timestral sidecar (Phase 4, licence-gated):** Containers `basic` fits the
measured ~100 MB RSS + torch; scale-to-zero matches the burst preference; cold
wake = container resume + ~2 s warm model load (**measure at Phase 4**). This
replaces B1's Render co-process plan for the real-model arm.

## 4. Q3 — data-layer redesign: R2-authoritative + backend-owned refresh

**Current state (measured 2026-11-18):**
- Bundled `data/tsfm/*.csv`: last bar **2026-10-26T00:00Z** (~5,000 bars from 2026-03-31).
- R2 `nt-tsfm-prices/tsfm/BTCUSD.csv` (via the bridge): **identical last bar** — same vintage.
- Prod has no `TSFM_R2_URL` → reads bundled files. **Both sources are 23 days stale.**
- The lab's 90-day origins grid sits entirely inside the stale window: every fan,
  eval, and verdict silently measures October, not now. Flipping prod to R2 alone
  fixes nothing — the refresh pipeline is the actual fix.

**Redesign:**

1. **Authority:** prod reads R2 only, via the lab Worker's binding (§2.1). Local
   dev keeps the file fallback through the Node adapter — explicit, never silent.
2. **Refresh — backend-owned (REVISED; authoritative spec:
   `noble-trader-fastapi-backend/docs/scopes/20261118_TSFM_R2_BACKEND_PUBLISH_SCOPE.md`):**
   the `tsfm-refresh` cron Worker of the first draft is **retired, never built** —
   it duplicated the sweep orchestrator's TDVA fetching (a second client, a second
   credential copy, 120 calls/day). Instead, an hourly APScheduler job
   (`tsfm-r2-publish`, `52 * * * *`, flag `tsfm_r2_publish.mode` off|shadow|live)
   in the trading backend reuses `fetch_tradingview_batch` — the sweep's own
   client, with the descending-order fix and staleness conventions already
   inside. The 5 lab symbols fit one batch call (`BATCH_CHUNK_SIZE=10`);
   `hours=5000` is exactly the TDVA cap (`min(hours, 5000)`) and the lab window;
   `ohlcv_out` yields ascending `{t,o,h,l,c,v}` rows — the CSV schema directly
   (`t` = epoch seconds → ISO-Z; None-t bars rejected, never invented). Uploads
   go through a **secret-gated PUT on the existing `nt-tsfm-data` bridge** (zero
   new Python deps, no S3 keys; one new shared secret `TSFM_R2_WRITE_SECRET` on
   the Worker + Studio + local `.env.local`). The job writes
   `tsfm/manifest.json` `{updated_at, publisher:"backend", source:"tdva",
   symbols:{S:{rows,first,last}}, errors}`; per-symbol fail-loud validation
   (rows ≥ 1000, ascending non-None timestamps, last bar ≤ 2 h, finite positive
   closes) keeps the previous CSV on any failure — never a partial write.
   **Trade-off, accepted:** freshness couples to Studio uptime; the lab serves
   the last vintage with a visible age stamp during outages, and
   `scripts/publish_tsfm_r2.py` (the SAME module, local runner) bootstraps/bridges
   from the laptop while Studio is down — one implementation, two runners.
3. **Vintage stamping + cache invalidation:** every overview/forecast/eval response
   gains `dataVintage {source:"r2", updated_at, last_bar, age_hours}`; harness
   cache keys include the manifest `updated_at` (§2.5). UI badge when age > 48 h —
   the lab warns, never refuses (frozen-vintage research stays possible). During
   a Studio outage the badge is the outage signal.
4. **Bridge worker `nt-tsfm-data`:** gains the authenticated PUT route (~25 lines:
   prefix allowlist `tsfm/*.csv` + `tsfm/manifest.json`, 1 MB body cap,
   `X-Write-Secret` header); public GET reads unchanged. The lab Worker itself
   reads via binding, not the bridge. Vercel's `TSFM_R2_URL` becomes unnecessary
   (proxies never read CSVs).
5. **Bootstrap:** the documented manual upload (`wrangler r2 object put
   nt-tsfm-prices/tsfm/S.csv --file data/tsfm/S.csv --remote` — `--remote` is
   mandatory, the `--local` mock has bitten before) stays as a fallback tool;
   the backend job owns steady state, and its local script runner is the
   preferred bootstrap (it validates + writes the manifest too).

## 5. Revised architecture

```
Vercel (web tier only)                 Cloudflare (lab compute + data)
app/api/tsfm-lab/* ──secret──►  tsfm-lab Worker (paid; harness + R2 binding)
                                   ▲   │ reads tsfm/*.csv + manifest
                                   │   ▼
                                R2 nt-tsfm-prices ◄── secret-gated PUT ── nt-tsfm-data bridge
                                                                             ▲
Studio: noble-trader-fastapi-backend                                         │ httpx + X-Write-Secret
  tsfm-r2-publish job (hourly :52) ── fetch_tradingview_batch (TDVA) ────────┘
  (the sweep's own client; scripts/publish_tsfm_r2.py = local outage bridge)

Render: nobletradingapp-backend (unchanged, for now)   Supabase: DB + edge triggers
Phase 4: tsfm-sidecar Container (licence-gated; torch ~100MB RSS) ← lab Worker fetch
```

Lab platform count: **Cloudflare only** for compute + data (vs B1's
Render+CF+Vercel split); the writer rides the trading backend that already owns
the feed. The Vercel routes stay as the web-tier proxies they should always have
been (`portfolio-analytics-warm` doctrine, 2026-10-05).

## 6. Phases and gates

| Phase | What | Gate (measurable) |
|---|---|---|
| **0 — evidence** | This doc's probes | **DONE 2026-11-18**: 30 MB live set, 76 KB bundle, 3.3 s CPU, R2 vintage confirmed stale, TV mapping verified |
| **1 — lab Worker** | `mini-services/tsfm-lab-worker/` (wrangler.toml: R2 binding, `limits.cpu_ms = 120000`, secret auth); `data.ts` source-injection refactor (math modules byte-identical); deploy on Workers Paid | Parity JSON-diff = 0 vs the current Vercel routes on the sample grid (5 series × 3 targets × h∈{1,6,24,72}, stand-in arms, same vintage), excluding timestamps. Cold eval CPU < 30 s in CF logs; no 1102/memory errors; `dataVintage` present |
| **2 — backend refresh + vintage** | Backend `tsfm-r2-publish` module + job + flag triple; bridge PUT route + write secret; manifest; vintage-keyed caches (backend scope §5 gates G1–G5) | Local bootstrap live run: bridge GET round-trip shows last bar ≈ now + md5 match (can pass BEFORE Studio returns). Studio live: manifest advances hourly, R2 last-bar age < 2 h, `overview.age_hours < 2`, eval recomputes after refresh |
| **3 — Vercel proxy flip** | Routes → lab Worker (secret server-side); harness imports removed from routes | Dashboard lab renders identically; `npm run build` + lint green; proxy stays inside the 60 s budget |
| **4 — real-model arm (GATED)** | Timestral sidecar as a CF Container; `TSFM_SIDECAR_URL` → container front | **G4a licence:** Modified-MIT revenue-cap clearance for a production subscription app (user/legal — blocker, unchanged). **G4b:** measured container wake + RSS within `basic`. **G4c:** one real forecast shape-verified (B,V,H,21); eval `timestral.available: true` |
| **5 — backend Containers (optional, last)** | Lift-and-shift the FastAPI image; front-door Worker | `/webapp/*` response parity; `portfolio-analytics-warm` env flip only; monthly cost within the §3 estimate |

Batch matrix (the 20-cell artefact): one Worker invocation **per cell** (each
~3–20 s CPU, inside the 120 s configured limit), results + a status manifest to
R2 `lab/`; optional cron/queue fan-out later. No long single request, no Durable
Object needed.

## 7. Cost delta

| Item | Today | After |
|---|---|---|
| Workers plan | Free (embeddings + bridge workers) | **Paid $5/mo** — confirm first; covers all workers |
| Lab compute | Vercel Hobby (60 s cap, sub-sampled diagnostics) | included CPU allotment ≈ 9,000 cold evals/mo — research usage far below |
| R2 | 2 MB + bridge reads | + hourly puts via the bridge (Class A, negligible) + binding reads (Class B, negligible) |
| TDVA quota | sweep usage | **+24 batch calls/day** (hourly, 5 symbols/call) — marginal; no CF-side TDVA creds needed |
| Render backend | $0 free | $0 — unchanged until Phase 5 |
| Phase 4/5 Containers | — | per-10 ms, sleep-after-15 m; ~$1–4/mo bursty (estimate), ≈ $6.5/mo always-on basic |

## 8. Open items / decisions needed

1. **Workers Paid confirmation/upgrade** (dashboard; the API token 403s on
   subscriptions; the embeddings worker's "Free-tier" header suggests Free today).
2. **Write-secret provisioning (user):** `TSFM_R2_WRITE_SECRET` via
   `wrangler secret put WRITE_SECRET` + Studio Secret + local `.env.local`
   (backend scope §6).
3. **Licence revenue cap** — Phase 4 blocker, unchanged from the prior scope.
4. **Refresh cadence** hourly (`52 * * * *`) vs 4 h — default hourly; a one-line
   crontab change in the backend job if TDVA quota is tight.
5. ~~What is the deployed `nobletradingapp` worker?~~ **RESOLVED 2026-11-18:** the
   embeddings proxy (`CF_EMBEDDINGS_URL`). New worker name `tsfm-lab` — no collision.
6. ~~TDVA creds on Cloudflare for the refresh cron~~ **RETIRED with the cron
   Worker** — creds stay in Studio Secrets (+ local `.env.local` for the script
   runner); nothing TDVA-related is provisioned on CF.

## 9. Not in scope

- No change to lab math, arms, eval protocol, or constants — instrument frozen;
  parity gates every move.
- No backend rewrite and no analytics-backend move before Phase 5.
- **No second TDVA client and no CF refresh cron** — the writer is the trading
  backend's own fetcher (the retired `tsfm-refresh` design is recorded in §4.2).
- No Supabase writes from Cloudflare (R2 only). No migrations.
- Do not conflate with the claims-layer `tsfm` vol-fan arm (TimesFM 2.5 sidecar on
  the trading backend — different model, different consumer, different thread).
- No MT5/talaria changes. No new hosting platform beyond the Cloudflare account
  already in use.

## 10. Storage review — R2 vs D1 (2026-11-18): R2 stays, on measured usage shape

**Usage profile (from the built pipeline):** 5 symbol-keyed CSVs (~400 KB,
5000 hourly rows each; 14 ≈ 5.6 MB after the §8 extension), a ~1 KB manifest,
and future batch artefacts (JSON, `lab/` prefix). Writes = **full-window
replacement hourly** (6 objects today, 15 at 14 symbols — self-healing: TDVA
revisions/backfills are absorbed by the replace). Reads = **whole-series blob
fetches** by the lab Worker via R2 binding (5 GETs + manifest per cold isolate);
all feature derivation happens in JS. **No SQL-shaped access exists anywhere**:
no range queries, no cross-symbol joins, no aggregates, no partial reads.

| Dimension | R2 (object store) | D1 (SQLite) |
|---|---|---|
| Ops per hourly refresh | **6 atomic object PUTs** (15 at 14 symbols) | full-refresh: 25K–70K row writes (DELETE+INSERT/upsert); incremental-append: ~14 rows but needs diff/reconciliation logic the full-window feed makes moot |
| Free-tier fit | 10.8K Class A/mo vs **1M included**; reads ≪ 10M Class B; 5.6 MB vs 10 GB → **$0** | full-refresh = 600K–1.68M rows written/day vs **100K/day free cap → 6–17× over**; paid 50M rows/mo included is exceeded at 14 symbols (50.4M/mo) |
| Paid cost at this scale | $0.015/GB-mo + $4.50/M A + $0.36/M B → **~$0** (rounding) | $0.75/GB-mo storage + $1/M rows written overage + query-engine overhead for unused SQL |
| Write ergonomics | one PUT per object, atomic — readers see old OR new complete window, never partial (matches the fail-loud keep-previous design) | **100 bound params/query + 100 KB statement cap** → 5000×6 values = 300+ chunked statements per symbol per refresh; batch API is transactional but heavy |
| Read path | 1 binding GET + CSV parse; measured 5-series load+derive = 0.65 s total | SELECT 5000 rows × 5 + JS row materialization — comparable or slower; 25K rows read per cold load (metered) |
| Query engine value | unused (none needed) | unused — indexes/joins/transactions have no consumer here |
| Build status | **bucket + bridge + binding + publisher BUILT and round-trip-verified today** | new DB + schema + migrations + bridge rewrite + publisher rewrite — rebuilding landed work for negative benefit |

**Verdict: R2 is more efficient AND the right fit.** Operations per refresh are
~4 orders of magnitude fewer (6 object ops vs 25K–70K row ops), atomicity matches
the design, cost is $0 within the free tier at both current and extended scale,
egress is free, and it is already built. D1's row-metered billing punishes
exactly the full-window replacement pattern TDVA provides, and its SQL strengths
have no consumer. The r2-datastore rule holds: *symbol-keyed price blobs, read
whole by the consumer, never queried → R2.*

**When D1 would win (revisit triggers, none true today):** SQL-shaped access
(cross-symbol joins, time-range slices, pushdown aggregates), high-frequency
small incremental writes with selective reads, or relational constraints with
other Cloudflare-side data. The TDVA full-window fetch makes the incremental
pattern moot; if the lab's access shape ever changes, re-run this review.
