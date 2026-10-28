# Kairos claims layer — Phase C build (SignalContextCard + widget chips)

**Date:** 2026-10-28
**Type:** Implementation (Phase C of the kairos-claims design —
kairos-backend `worklog/20261027_KAIROS_CLAIMS_LAYER_DESIGN.md` §4 row C,
§2 "the frontend disconnect"; this repo's companion plan in
`docs/worklog-kairos-claims.md`).
**Scope guard:** rendering-only. Zero changes to signal consumption semantics,
the MT5/talaria-copy path (`SIGNAL_COLUMNS` untouched), API route contracts,
or any data-fetching logic beyond ONE latent-bug fix (§3). No flag on the
frontend (the design doc's Phase C row: "frontend, no flag") — the backend's
`claims_publish` gates the wire; the card renders whatever arrives.

---

## 0. What landed

| Piece | File | What it does |
|---|---|---|
| The card | `app/components/signal-context-card.jsx` (new) | `SignalContextCard` — the selected symbol's registered claim: quantile fan SVG (bands 50/80/90 + median + anchor dot), ENTRY/SL/TP dashed lines drawn ON the fan with right-edge price labels, badge row (status/kind/source/horizon/TP-q·SL-q), Claimed Probabilities section (p_resolve, p_win\|resolve, p_win_bracket + the barrier-null π triple), Scored Outcome section (result + cov50/80/90 + CRPS + brier + exit/hold/scored-horizon), honest empty state when no claim. Exports `claimOf()` (dual-name getter). |
| Widget chip | `app/dashboard/page.jsx` | `ClaimPosChip` in `FloatingSignalsWidget`'s row header — "TP q88 · SL q12" (badge-secondary, tooltip explains the fan-space stamp); "fan" ghost badge fallback when a claim exists without quantile positions; nothing when no claim. |
| claimOf getter | `app/dashboard/page.jsx` | `claimOfSignal(s)` — `s?.claim ?? s?.signal_claim` (the `rankOf`/`stateOf` name-drift convention). |
| Mount | `app/dashboard/page.jsx` | Market tab, between `RenkoSection` and `MarkovSection` — the exact gap where the original SignalContextCard (commit `a22c8dd`, removed by `695ea45`) used to sit. Fed by `selectedSweepRow` (live-broadcast rows override REST rows via `mergedSweeps`; both can carry `.claim`). |
| Poll-path bug fix | `app/dashboard/page.jsx` | Removed the stray `setIsLoading(false)` in the 5-min poll callback — no such setter exists; the ReferenceError was swallowed by `.catch(() => {})` and **aborted the callback**, leaving the poll's liveSignals re-seed block dead code. This fix is load-bearing for claims: post-resolution outcome updates reach the dashboard through the poll/bundle path. |

## 1. Design decisions (and why)

**The fan chart is a compact port of `components/tsfm-lab/fan-chart.tsx`**
(bandPath/medianPath geometry, the 90/80/50 band tiers) re-keyed for claim
fans: **x = hour offset h** (anchor at h=0, the entry price — claims fans
are entry-anchored by construction) instead of timestamps, and **y = price
verbatim** — no `lift`/log-space handling at all, because the claim is
already PRICE space at the boundary (the design §1 units contract; the lab's
fan-axis bug class is structurally impossible here). Bracket levels render
as the `RenkoSection` dashed-line idiom (position-based colors: ENTRY
base-content, SL error, TP success; `strokeDasharray="4 2"`, right-edge
labels) with daisyUI CSS-var fills so the card sits on the noble theme
(tsfm-lab's hard-coded orange is a different, dark-lab surface).

**One claim shape, two transports.** The card reads `sweepRow.claim` — which
arrives identically from the realtime broadcast (Phase B transport #2:
optional `claim` object on the `signal` event, attached only after the
ledger write persisted) and from `/api/dashboard-data` sweeps rows (Phase B
transport #1: migration 219's `v_talaria_latest_signals.claim` column —
latest claim per symbol, outcome included). The broadcast passthrough needed
ZERO frontend code (the normalization handler stores the whole object);
the REST path needed zero route changes (`select("*")`). Phase C is purely
the rendering that was missing.

**Honesty rules, enforced in the copy.** The subtitle states the fan is a
pre-registered distribution frozen at qualification and scored at resolution
through the same settlement contract; the `atr_normal` badge's tooltip says
it is the baseline control arm the Phase-D recalibrated vol fans must beat;
no claim → an explicit "No registered claim on this signal" state (never a
fake fan); the outcome section appears only when `status: resolved` carries
an outcome object; open claims say "Awaiting resolution — the fan scores
when the 48h window closes". Coverage chips tone by distance from nominal
(±0.05 success, ±0.10 warning, else error).

**Status badges**: OPEN → warning, RESOLVED → success, VOID → ghost — with
tooltips explaining the ledger semantics. The claim footer shows claim ts,
signal id prefix, and ref-h — the staleness facts (the bundle's claim is
latest-per-symbol and may predate a neutral sweep).

## 2. Verification

* `npm run lint` — **0 errors** (14 warnings = the repo's pre-existing
  react-hooks baseline, none in touched files). `npx tsc --noEmit` — clean.
* **Browser E2E** (agent-browser, dev server :3010, temp `DEMO_CLAIMS=1`
  stubs returning a realistic demo bundle whose claim fan mirrors the
  backend's ATR normal-approx math — entry·exp(z·σ·√h), σ = ATR/entry):
  * **EURUSD (resolved claim)**: fan bands widen left→right, median line,
    ENTRY/SL/TP dashed lines with right-edge prices, y-axis + x-axis (+0h…
    +48h) labels, origin dot; badges EURUSD / RESOLVED / bracket /
    atr_normal / 48h / TP q88 · SL q12; claimed probabilities rows + π
    triple; outcome chips **TP · cov50 0.52 · cov80 0.77 · cov90 0.87 ·
    CRPS 0.0031 · brier 0.090** + Exit/Hold/Scored-horizon rows. (VLM-read
    from screenshot; the only "defects" were the auto-opened floating widget
    overlaying the page bottom — pre-existing behavior — and screenshot
    viewport cuts.)
  * **BTCUSD (open claim)**: full card renders — OPEN badge, fan chart
    (y 65,572→73,097, ENTRY 69,250 / SL 67,900 / TP 71,500 labels),
    probabilities, "Awaiting resolution…" copy, claim-ts/signal-id footer.
  * **XAUUSD (claim: null)**: honest empty state, no fan, no badges.
  * **Widget chip**: BTCUSD row shows "TP q88 · SL q12" in the floating
    signals widget; XAUUSD row shows no chip. (VLM-verified.)
  * **Mobile 390px**: no horizontal overflow (`scrollWidth ==
    clientWidth`), card width 358/390.
  * **Zero page errors**; console filtered clean of anything but dev noise
    (React DevTools, HMR, Vercel Analytics debug, the Renko empty-bricks
    warning from the demo bundle's empty renkoBricks).
  * y-axis ticks were fixed to uniform spacing (0/25/50/75/100% of the
    padded range) after the first screenshot showed crowded top ticks.
* **Sandbox-only artifacts (NOT in the shipped diff)**: temporary
  `DEMO_CLAIMS=1` stubs in `app/api/dashboard-data/route.js` +
  `app/api/subscription-status/route.js` and a passthrough stub of
  `proxy.js`'s clerkMiddleware (placeholder Clerk keys make the dev-instance
  handshake redirect every request to `placeholder-dev.clerk.accounts.dev`,
  host_invalid — the same class of workaround as the GARCH-port session).
  All three reverted byte-for-byte after E2E (`git checkout --`, verified
  against a pre-edit backup; `git status` shows only the two Phase C files).
  Dev server run with dummy NEXT_PUBLIC_SUPABASE_URL so the realtime client
  constructs (it fails to connect in the sandbox — the poll path covers it).

## 3. The poll-path bug (fixed, load-bearing for Phase C)

`page.jsx`'s 5-min poll callback called `setIsLoading(false)` — **no such
setter exists anywhere in the file**. The ReferenceError aborted the rest of
the callback (swallowed by the trailing `.catch(() => {})`), so the poll's
liveSignals re-seed block (lines that mirror the initial fetch) was dead
code. For claims this matters twice: (a) post-resolution outcome updates
reach `sweeps` (and thus the card) through the poll/bundle path, and (b) the
widget's claim chips refresh with it. Fix = delete the stray line; behavior
is exactly what the callback was written to do. This was found by the Phase C
exploration pass, not by an error report — it failed silently.

## 4. Non-goals honored

* **MT5/EA/bridge/talaria-copy untouched**: `SIGNAL_COLUMNS` and
  `planSignals` in `supabase/functions/talaria-copy/index.ts` were never
  opened; the bridge and EA read named fields only; the broadcast `claim`
  key is inert to all of them (backend design §1 transport contract).
* No changes to `RenkoSection`, `SignalRankingBoard`, `KellyTable`,
  calibration tabs, or any fetch logic beyond the dead-line removal.
* No new deps; the card is stdlib React + inline SVG (the tsfm-lab
  fan-chart is a TS dark-surface component — porting beats importing).

## 5. What the operator must do

1. Nothing on the frontend — the card ships dark (renders nothing when no
   claim arrives) and lights up as soon as the backend applies migration
   219 (bundle path) and/or flips `claims_publish: "live"` (wire path).
2. Verify on the live dashboard after the next qualified signal post-219:
   market tab → Signal Context card renders the fan + bracket positions;
   the floating widget rows gain "TP qNN · SL qNN" chips.
