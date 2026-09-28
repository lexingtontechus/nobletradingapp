# Worklog: Renko Chart Grid Mismatch + Orphan Purge — 2026-09-28

> **Status:** BUILD COMPLETE (code landed locally, not pushed).
> **Build gate:** Build Code authorized 2026-09-28. Push git still pending.
> **Related:** `worklog-renko-chart-tp-sl-bug.md` (2026-08-31 direction bug — already fixed).

---

## 1. Symptom

Dashboard Renko chart (`RenkoSection`) shows ENTRY / SL / TP dashed lines
**far from the brick series** for XAGUSD, XAUAUD, XAUEUR, US500, US30USD, AAPL.
User read: “entry, SL, TP pricing way below the current market value.”

Example screenshot (XAUAUD): bricks near ~$7000, levels clustered ~$5858–6000.
Chart auto-scales across both planes, so the gap looks extreme.

---

## 2. What is NOT broken

Live DB check (2026-09-28 20:31Z) confirms signal math is correct.

User-supplied XAUEUR signal matches `v_talaria_latest_signals` exactly:

| Field | Value | Geometry |
|---|---|---|
| signal | SELL | |
| entry_price | 3624.42625 | |
| stop_loss | 3628.904005 | above entry ✓ |
| take_profit | 3617.261842 | below entry ✓ |

`_compute_trade_signal` (orchestrator.py) is fine:
`entry = current_price = prices[-1]`; SL/TP = entry ± `brick_size * sl/tp_bricks`.

The 2026-08-31 `signal` vs `direction` brick-direction bug is already fixed
and is **not** this issue.

When bricks are read on the **same `brick_size` grid as the signal**, they
match entry within 0.005%–0.4%:

| Symbol | Entry | Brick close (same bs) | Gap |
|---|---|---|---|
| AAPL | 338.415 | 338.433 | 0.005% |
| XAUAUD | 5872.57 | 5884.16 | 0.2% |
| XAUEUR | 3624.43 | 3635.04 | 0.3% |
| XAGUSD | 60.78 | 61.03 | 0.4% |

**Conclusion:** levels are right. The chart is plotting the wrong brick series.

---

## 3. Root cause A — chart mixes `brick_size` grids

### Data model

`nt_renko_bricks` unique key is
`(symbol, brick_index, session_date, brick_size)` (migration 145).
Heavy sweep **re-optimizes `brick_size` daily**, so a symbol can hold
several grids at once (confirmed live: XAUAUD has bs=1.474 / 1.453 / 1.213;
AAPL has bs=0.088433 / 0.089089; US30USD has 6 distinct sizes).

### Chart query (the bug)

`app/dashboard/page.jsx` `RenkoSection`:

```js
const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === activeSym);
const bricks = symbolBricks.slice(0, 10).reverse().map(...)
```

`/api/dashboard-data` fetches `v_talaria_renko` ordered by
`session_date DESC, brick_index DESC` **with no `brick_size` filter**.

ENTRY/SL/TP come from `sweepRow.brick_size`’s grid (via `nt_sweep_result`).
Bricks come from whatever grid has the highest `brick_index`. Those are
often **different grids**.

### Live mismatch (same moment)

| Symbol | Signal bs (entry) | Stale grid plotted | Higher maxIdx? |
|---|---|---|---|
| XAUAUD | 1.474 → 5884 | 1.213 → **6069** | 1109 > 966 |
| XAUEUR | 0.896 → 3635 | 0.807 → **3740** | 1064 > 1027 |
| AAPL | 0.0884 → 338.4 | 0.0891 → **341.4** | 1929 > 1905 |
| XAGUSD | 0.115 → 61.0 | 0.032 → **62.8** | 849 ≫ 191 |
| US500 | 2.278 → **no rows** | 0.464 → 7709 | — |
| US30USD | 6.182 → **no rows** | 4.190 → 51686 | — |

US500 / US30USD are worse: the signal’s current `brick_size` has **zero**
brick rows, so the chart is entirely on another grid.

---

## 4. Root cause B — orphan high `brick_index` rows

### Where it occurs

Write path (every light sweep, ~15 min):

1. `orchestrator.py` brick-capture block (~L4873)
   - `RenkoBrickEngine(brick_size=brick_size).build_from_prices(prices, ...)`
2. `build_from_prices` (**`renko/brick_engine.py`**)
   - calls `self.reset()` → `brick_count = 0`
   - emits bricks with `index = 0, 1, 2, …, N-1` (N = bricks in THIS build)
3. `log_renko_bricks` (**`sweep_orchestrator/supabase_client.py` ~L621**)
   - upserts those N rows on
     `on_conflict=symbol,brick_index,session_date,brick_size`
     with `Prefer: resolution=merge-duplicates`

### The orphan gap

Upsert only overwrites indices `0..N-1`. It never deletes.

If a **previous** build produced **more** bricks (indices `0..M` with `M > N`),
rows `N..M` survive untouched. Those leftover high-index rows are **orphans**:

- same symbol, same `brick_size`, same `session_date`
- but they belong to an older, longer build
- they carry older prices

Because the chart (and `v_talaria_daily_close`) order by
`brick_index DESC`, orphans **sort first** and win the “last 10” window.

### Concrete example (AAPL)

```
current build:  indices 0..200   prices ~338   (bs=0.088433)
previous build: indices 0..1905 prices ~341   (same or other bs)
after upsert:   0..200 overwritten, 201..1905 ORPHANED
chart "last 10": 1905, 1904, … → old ~341 plane
signal entry:   338.415         → current plane
```

This is independent of grid-mixing (Root A). Even with a single grid,
a shorter rebuild leaves orphans above the live series.

### Where it is *cleaned* today (and where it is not)

Nightly `renko_retention.py` (Part VI of eod-lookback) deletes:

1. **Stale `brick_size` grids** — `brick_size` ≠ live `config/brick_params.yaml`
2. **Old sessions** — `session_date` older than `renko_brick_retention_days` (default 2)

It does **NOT** delete:

> same `(symbol, brick_size, session_date)` with `brick_index` greater than
> the current build’s max index.

That is the orphan purge gap. Retention bounds **which grids/sessions**
exist; it does not bound **the index range within a live grid**.

### Same-class consumer bug

`v_talaria_daily_close` (nobletradingapp migration 0011) also does
`DISTINCT ON (symbol, session_date) … ORDER BY brick_index DESC` with
**no `brick_size` filter** — correlation closes can be taken from a stale
grid/orphan row.

---

## 5. Fix design

### Fix 1 — Chart: plot only the signal’s grid (primary)

**Where:** `nobletradingapp` (dashboard)

Option A (preferred, query-level):
- `/api/dashboard-data` (or the brick fetch) filter
  `brick_size` to each symbol’s latest sweep `brick_size`
- or add a view `v_talaria_renko_live` =
  bricks joined to latest signal’s `brick_size` only

Option B (defensive, UI-level):
- in `RenkoSection`, after fetching, keep only
  `b.brick_size == sweepRow.brick_size` (numeric tolerance like retention’s 0.1%)
- if no bricks match, fall back to `generateBricks` (or show “no live grid”)

Also:
- Prefer real bricks that end near `entry_price` when both grids exist
- Surface a one-line “market proxy” = latest `close_price` of the live grid
  next to ENTRY so any future mismatch is obvious

### Fix 2 — Orphan purge on write (backend)

**Where:** `noble-trader-fastapi-backend`

After a successful `log_renko_bricks` upsert of indices `0..N-1`:

```
DELETE FROM nt_renko_bricks
WHERE symbol = :symbol
  AND brick_size ≈ :brick_size          -- same float-tol as retention
  AND session_date = :session_date
  AND brick_index > :max_index_written  -- N-1
```

Implementation notes:
- do it in the same `log_renko_bricks` (or a follow-up task) so every
  sweep tick self-heals
- use the same relative brick_size tolerance as
  `renko_retention._delete_stale_brick_size` (0.1% / 1e-9 floor)
- `Prefer: count=exact` to log deleted-orphan counts
- never raise — best-effort like the rest of the brick capture

Optional belt-and-braces: a small `purge_orphans` helper also callable
from `renko_retention` (same-grid high-index sweep) so a missed tick
still heals nightly.

### Fix 3 — Close the same hole in daily-close view

`v_talaria_daily_close`: pick the close from the **live** `brick_size`
grid (join latest signal / `brick_params`), not global max `brick_index`.

### Fix 4 — US500 / US30USD empty live grid

Verify light-sweep brick capture is actually writing under the signal’s
`brick_size` for these symbols (currently 0 rows). If capture is skipped
(e.g. event-loop / brick_size mismatch), fix that path so Fix 1 has data.

---

## 6. Build plan (ordered)

| Step | Repo | Change | Verify |
|---|---|---|---|
| B1 | nobletradingapp | `RenkoSection` filter bricks to `sweepRow.brick_size` (tol) | lint; manual chart: XAUAUD/XAUEUR/AAPL levels sit on brick plane |
| B2 | nobletradingapp | `/api/dashboard-data` or view: prefer live-grid bricks | curl dashboard-data: each symbol’s bricks share sweep `brick_size` |
| B3 | fastapi-backend | orphan DELETE after `log_renko_bricks` | unit test: shorter rebuild leaves no `brick_index > N-1` |
| B4 | fastapi-backend | optional `renko_retention` same-grid orphan pass | CLI summary `deleted_orphans` |
| B5 | nobletradingapp | `v_talaria_daily_close` live-grid filter | correlation closes match signal grid |
| B6 | both | market-proxy line / tooltip on chart | visual QA on 6 problem symbols |

**Suggested severity:** high (subscriber-facing wrong prices on every symbol).

---

## 7. Verification checklist (after Build Code)

```bash
# frontend
cd nobletradingapp && eslint .
npm run build

# backend
cd noble-trader-fastapi-backend
PYTHONPATH="$PWD/src" ./.venv/Scripts/python.exe -m pytest tests/ -q -p no:cacheprovider
# especially tests/test_renko_snapshot_capture.py
```

Live smoke:
1. For each of XAGUSD, XAUAUD, XAUEUR, US500, US30USD, AAPL:
   - `sweep.brick_size` == bricks’ `brick_size`
   - `|last_brick.close - entry| / entry` < ~1% (or explained by live tick)
   - ENTRY/SL/TP lines overlap the brick price band on the SVG
2. Query `nt_renko_bricks` for one symbol: max(`brick_index`) equals the
   count of rows on the live `(symbol, brick_size, session_date)` grid
   (no orphan tail).

---

## 8. Files touched (planned)

| File | Role |
|---|---|
| `nobletradingapp/app/dashboard/page.jsx` | `RenkoSection` brick filter + market proxy |
| `nobletradingapp/app/api/dashboard-data/route.js` | optional live-grid brick select |
| `nobletradingapp/supabase/migrations/00xx_…` | optional `v_talaria_renko_live` / daily_close fix |
| `noble-trader-fastapi-backend/regime_platform/sweep_orchestrator/supabase_client.py` | orphan purge in `log_renko_bricks` |
| `noble-trader-fastapi-backend/regime_platform/sweep_orchestrator/renko_retention.py` | optional nightly orphan pass |
| `noble-trader-fastapi-backend/tests/test_renko_snapshot_capture.py` | orphan-purge unit tests |

---

## 9. See also

- `nobletradingapp/docs/worklog-renko-chart-tp-sl-bug.md` — prior direction/label bug
- `noble-trader-fastapi-backend/regime_platform/sweep_orchestrator/renko_retention.py` — nightly grid/session bounds (does not cover same-grid orphans)
- `noble-trader-fastapi-backend/worklog/20260909_CALIBRATION_AND_SCORING_METHODOLOGY_REFRAME.md` §7 Finding 2 — why `brick_size` is in the unique key
- `nobletradingapp/supabase/migrations/0011_correlation_cache.sql` — `v_talaria_daily_close` same ordering issue

---

## 10. Decision log

| Date | Decision |
|---|---|
| 2026-09-28 | Assessment complete: signal prices correct; chart plots wrong `brick_size` grid + orphan high indices. |
| 2026-09-28 | Worklog written for chart fix + orphan purge. |
| 2026-09-28 | **Build Code** authorized and landed (local only). |

---

## 11. Build record (2026-09-28)

### Landed

| Step | Change | File |
|---|---|---|
| B1 | `brickSizeMatches` (0.1% rel tol) + `pickLiveGridBricks` — filter bricks to sweep `brick_size`, sort `brick_index DESC` | `nobletradingapp/app/dashboard/page.jsx` |
| B1 | `RenkoSection` uses live grid; empty live grid → `generateBricks` (entry plane, not stale grid) | same |
| B1 | Market proxy line: last brick close vs entry + Δ% + grid bs | same |
| B1 | `MarkovSection` uses the same live-grid filter | same |
| B3 | `_purge_orphan_renko_bricks` + call after successful upsert | `noble-trader-fastapi-backend/.../supabase_client.py` |
| B3 | Purge only on successful POST; same-grid (`brick_size` 0.1% band), `brick_index > max(written)`, same `session_date` | same |
| tests | 4 new tests: purge issues DELETE, band covers roundtrip, skip on insert fail, helper never raises | `tests/test_renko_snapshot_capture.py` |

### Verification

```
pytest tests/test_renko_snapshot_capture.py tests/test_renko_retention.py  → 23 passed
eslint app/dashboard/page.jsx  → 0 errors, 3 pre-existing react-hooks warnings
```

### Deferred (not in this build)

| Step | Why |
|---|---|
| B2 | Server-side view filter — frontend filter is sufficient; cache still carries all grids |
| B4 | Nightly `renko_retention` same-grid orphan pass — write-path purge self-heals every 15 min |
| B5 | `v_talaria_daily_close` live-grid filter — correlation path, separate consumer |
| B6 | US500/US30USD empty live grid capture — needs producer-side investigation |
| push | No git push — awaiting explicit push approval |
