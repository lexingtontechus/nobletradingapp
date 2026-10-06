# Worklog: Kairos Frontend Harmonization — Full Assessment + Fix Plan

> **Date:** 2026-10-05
> **Status:** BUILD COMPLETE (B1–B10 landed locally, not pushed)
> **Scope:** Backend Kairos implementations → Supabase views → nobletradingapp dashboard
> **Related:** `worklog-renko-chart-tp-sl-bug.md`, `worklog-renko-chart-grid-mismatch-and-orphan-purge.md`, `worklog/kairos/README.md`

---

## 1. Executive Summary

The backend (`noble-trader-fastapi-backend`) has accumulated **15+ Kairos modules** implementing dynamic deadline tiers, ATR-anchored geometry, regime-transition ranking, macro pivot labeling, and calibration scorecard maths. Most of these compute rich per-signal metrics (drift horizons, path excursions, geometry risk, deadline tiers, rank scores) that are **persisted to Supabase** but **never surfaced on the frontend**.

The frontend (`nobletradingapp`) dashboard shows only a thin slice: entry/SL/TP prices, brick_size, kelly, regime label, and a single `kairos_rank_score` composite. The renko chart bug (price lines above brick price) is a **symptom of this gap** — the chart plots bricks from a different `brick_size` grid than the sweep result because the frontend has no visibility into the ATR-scaling pipeline that produces the brick_size.

**Goal:** Surface the full Kairos signal context on the dashboard so users can see *why* a signal has its geometry, *when* it should resolve, *how good* the regime edge is, and *what* the macro backdrop is.

---

## 2. Backend Kairos Implementation Inventory

### 2.1 Core Capture Modules

| Module | What it computes | Persisted where | Frontend visible? |
|---|---|---|---|
| `kairos.py` | CLV, efficiency ratio, relative volume, ATR ratio run, spread BPS | `nt_signal_sim` (shadow columns) | ❌ No |
| `kairos.py` | Drift horizons (1h/4h/12h/24h/48h) | `nt_signal_sim.drift_*h_pct` | ❌ No |
| `kairos.py` | Path excursions (MAE/MFE at 4/12/24/48h) | `nt_signal_sim.mae_*h_pct`, `mfe_*h_pct` | ❌ No |
| `kairos.py` | Economic calendar cache | `.cache/kairos/econ_calendar.json` | ❌ No |
| `kairos.py` | Kairos run tracker (regime cell age, ATR at start) | In-memory + `regime_state_store` | ❌ No |
| `kairos_rank.py` | Composite rank score (freshness + transition + recent TP + cell P) | `nt_signal_sim.kairos_rank_score` | ⚠️ Partial (composite only) |
| `kairos_rank.py` | Event window, transition type, tau_h | `nt_signal_sim` (shadow) | ❌ No |
| `kairos_pivot.py` | Macro event pivot labels (major_pivot/incremental/no_change) | `nt_macro_forecast.pivot_*` | ❌ No |
| `kairos_quant.py` | No-skill line, calibration error, accuracy vs no-skill | Research only | ❌ No |

### 2.2 Geometry & Deadline Modules

| Module | What it computes | Persisted where | Frontend visible? |
|---|---|---|---|
| `dynamic_deadline.py` | Per-(symbol, vol_tier) deadline tiers (soft/hard/median hours) | `nt_roadmap.current_state` (JSON) | ❌ No |
| `geometry_risk.py` | Long-lag risk, geometry risk score, pct_expired, p90_hours | `nt_bracket_reachability` | ❌ No |
| `geometry_risk.py` | `brick_vol_scale()` — ATR drift scaling factor | Applied to `brick_size` in sweep | ❌ No (implicit) |
| `geometry_risk.py` | `vol_drift_factor()` — ATR expansion risk weight | Applied in geometry risk | ❌ No |
| `tiered_atr.py` | Dynamic ATR TP/SL pick (walk-based expectancy) | `nt_brick_params_state` | ❌ No |
| `tiered_atr.py` | `compute_vol_ratio()` — short/long realized vol | Used as gate | ❌ No |
| `tiered_atr.py` | `DynamicAtrPick` (tp_atr, sl_atr, expectancy, expiry) | `nt_brick_params_state` | ❌ No |
| `atr_reopt.py` | Monthly free-lattice ATR re-optimum | `nt_roadmap` + report files | ❌ No |
| `first_passage.py` | First-passage geometry (replaces HMM) | `nt_signal_sim` (shadow) | ❌ No |
| `variable_kelly.py` | Variable Kelly sizing | `nt_sweep_result.effective_kelly` | ⚠️ Partial (final value only) |

### 2.3 Supporting Modules

| Module | Purpose | Frontend visible? |
|---|---|---|
| `cell_conditioning.py` | Cell conditioning for calibration | ❌ No |
| `calibration_quality_gate.py` | Calibration quality gate | ❌ No |
| `hmm_shadow_accuracy.py` | HMM shadow accuracy tracking | ❌ No |
| `fp_eval.py` | First-passage evaluation | ❌ No |
| `regime_state_store.py` | Restart-safe regime state persistence | ❌ No |
| `eod_correction.py` | 4h EOD correction passes | ❌ No |
| `eod_resolver.py` | EOD signal resolver | ❌ No |
| `heavy_sweep_reachability.py` | Heavy sweep reachability grid | ❌ No |
| `p_win_bracket.py` | p_win bracket lookup | ❌ No |
| `geometry_incubation.py` | Geometry incubation tracking | ❌ No |

---

## 3. The Renko Brick Bug — Root Cause

### 3.1 Symptom

Dashboard renko chart shows ENTRY/SL/TP price lines **above** the brick price series for BTCUSD and USDJPY. The bricks appear to be on a different price plane than the trade levels.

### 3.2 Root Cause

The `brick_size` stored in `nt_sweep_result` (e.g., `0.748404407174975` for BTCUSD) is the **ATR-scaled value** after `geometry_risk.py:brick_vol_scale()` applies a volatility ratio to the YAML base value (250.0). The bricks in `nt_renko_bricks` are built with this same scaled `brick_size`.

However, the frontend's `pickLiveGridBricks()` filter (`app/dashboard/page.jsx:549`) matches bricks to the sweep result by `brick_size` with a 0.1% tolerance. When:

1. **Multiple `brick_size` grids exist** for the same symbol (from different ATR regimes), the filter may select bricks from a stale grid if the tolerance is too tight or the cache is stale.
2. **The `talaria_dashboard_cache` is stale** (refreshed every 2 min by pg_cron), it may serve bricks from a previous sweep with a different `brick_size`.
3. **The `brick_size` float representation differs** between the sweep result and the brick rows (e.g., `0.748404407174975` vs `0.748404407174976`), causing the 0.1% tolerance to fail.

### 3.3 Why This Matters Beyond the Chart

The renko brick bug is a **visible symptom** of a larger gap: the frontend has no visibility into the ATR-scaling pipeline. Users see a `brick_size` of `0.748` for BTCUSD (which normally has `brick_size=250.0`) with no explanation. The dashboard should surface:

- The **base brick_size** from YAML
- The **ATR scale factor** applied
- The **reason** for the scaling (volatility contraction/expansion)
- The **vol_ratio** that gated the dynamic ATR pick

---

## 4. What the Frontend Currently Shows

### 4.1 Dashboard Data Bundle (`/api/dashboard-data`)

| Field | Source | Kairos context |
|---|---|---|
| `sweeps` | `v_talaria_latest_signals` | entry/SL/TP, brick_size, kelly, regime, signal |
| `renkoBricks` | `v_talaria_renko` | brick open/close/price |
| `kelly` | derived from sweeps | effective_kelly |
| `signalHealth` | `v_talaria_signal_health` | regime conf, markov p_up/dn |
| `calibration` | `v_eod_calibration_bias_latest` | bias, expected vs actual |
| `calibrationBoard` | `v_calibration_confidence_board` | L1 honest status |
| `outcomeBySide` | `v_signal_outcome_by_side` | buy vs sell outcomes |
| `regimeEdge` | `nt_regime_edge` | win rate, expectancy by regime |
| `paperPositions` | `v_paper_positions` | paper trade P&L |
| `paperEquity` | `v_paper_equity` | equity curve |

### 4.2 What's Missing (Kairos Context)

| Missing field | Backend source | Why it matters |
|---|---|---|
| `soft_deadline_hours` | `dynamic_deadline.py` | When the signal should resolve |
| `hard_deadline_hours` | `dynamic_deadline.py` | When the signal goes stale |
| `expected_resolution_hours` | `dynamic_deadline.py` | Median expected resolution time |
| `resolution_confidence` | `dynamic_deadline.py` | High/medium/low confidence |
| `geometry_risk_hat` | `geometry_risk.py` | Long-lag risk score |
| `long_lag_hat` | `geometry_risk.py` | Estimated expiry probability |
| `pct_expired` | `nt_bracket_reachability` | Observed expiry rate |
| `p90_hours` | `nt_bracket_reachability` | 90th percentile resolution time |
| `tp_distance_atr` | `geometry_risk.py` | TP distance in ATR units |
| `sl_distance_atr` | `geometry_risk.py` | SL distance in ATR units |
| `atr_ratio_run` | `kairos.py` | ATR now / ATR at regime start |
| `brick_vol_scale` | `geometry_risk.py` | ATR scaling factor applied to brick_size |
| `vol_ratio` | `tiered_atr.py` | Short/long realized vol ratio |
| `tp_atr` | `tiered_atr.py` | Dynamic ATR TP pick |
| `sl_atr` | `tiered_atr.py` | Dynamic ATR SL pick |
| `exp_atr` | `tiered_atr.py` | Expected value in ATR |
| `expiry` | `tiered_atr.py` | Expiry rate |
| `drift_12h_pct` | `kairos.py` | 12h price drift |
| `drift_48h_pct` | `kairos.py` | 48h price drift |
| `mae_24h_pct` | `kairos.py` | 24h max adverse excursion |
| `mfe_24h_pct` | `kairos.py` | 24h max favourable excursion |
| `clv_1h` | `kairos.py` | Close-location value |
| `efficiency_24h` | `kairos.py` | Kaufman efficiency ratio |
| `rel_volume_1h` | `kairos.py` | Relative volume |
| `spread_bps` | `kairos.py` | Spread in basis points |
| `kairos_event_window` | `kairos_rank.py` | fresh/warm/stale/deep |
| `kairos_transition` | `kairos_rank.py` | dir_flip/vol_expand/vol_contract |
| `pivot_label` | `kairos_pivot.py` | major_pivot/incremental/no_change |
| `pivot_axis` | `kairos_pivot.py` | reaction_function/tool/trajectory |
| `pivot_intensity` | `kairos_pivot.py` | 0-1 intensity |
| `pivot_summary` | `kairos_pivot.py` | Human-readable summary |

---

## 5. Fix Plan

### Phase 1 — Backend: Expose Kairos Fields via Supabase Views

**Goal:** Make all Kairos-computed fields available to the frontend via PostgREST.

#### 1.1 Extend `v_talaria_latest_signals`

Add columns from `nt_signal_sim` (joined on `signal_id`):

```sql
-- New columns to add to v_talaria_latest_signals:
--   soft_deadline_hours, hard_deadline_hours, expected_resolution_hours,
--   resolution_confidence, geometry_risk_hat, long_lag_hat, pct_expired,
--   p90_hours, tp_distance_atr, sl_distance_atr, atr_ratio_run,
--   brick_vol_scale, vol_ratio, tp_atr, sl_atr, exp_atr, expiry,
--   drift_12h_pct, drift_48h_pct, mae_24h_pct, mfe_24h_pct,
--   clv_1h, efficiency_24h, rel_volume_1h, spread_bps,
--   kairos_event_window, kairos_transition, kairos_rank_score
```

**Approach:** Modify the view to LEFT JOIN `nt_signal_sim` on `signal_id` (already available in `nt_sweep_result`). Add the Kairos columns to the SELECT.

#### 1.2 Create `v_talaria_deadline_tiers`

New view over `nt_roadmap` (or a new table) for deadline tiers:

```sql
CREATE OR REPLACE VIEW public.v_talaria_deadline_tiers AS
SELECT
  symbol,
  vol_tier,
  soft_deadline_hours,
  hard_deadline_hours,
  median_hours,
  n,
  confidence
FROM public.nt_deadline_tiers;  -- new table, populated by dynamic_deadline.py
```

#### 1.3 Create `v_talaria_geometry_risk`

New view over `nt_bracket_reachability`:

```sql
CREATE OR REPLACE VIEW public.v_talaria_geometry_risk AS
SELECT
  symbol,
  vol_tier,
  distance_atr_bucket,
  pct_expired,
  p90_hours,
  n_stored,
  n
FROM public.nt_bracket_reachability
WHERE n_stored >= 3;
```

#### 1.4 Create `v_talaria_kairos_pivots`

New view over `nt_macro_forecast`:

```sql
CREATE OR REPLACE VIEW public.v_talaria_kairos_pivots AS
SELECT
  symbol,
  pivot_label,
  pivot_axis,
  pivot_intensity,
  pivot_surprise,
  pivot_as_of,
  pivot_event_title,
  pivot_summary
FROM public.nt_macro_forecast
WHERE pivot_label IS NOT NULL;
```

### Phase 2 — Backend: Persist Deadline Tiers to a Table

Currently `dynamic_deadline.py` stores tiers in `nt_roadmap.current_state` as JSON. This is not queryable. Create a proper table:

```sql
CREATE TABLE IF NOT EXISTS public.nt_deadline_tiers (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  vol_tier TEXT NOT NULL,
  soft_deadline_hours FLOAT NOT NULL,
  hard_deadline_hours FLOAT NOT NULL,
  median_hours FLOAT NOT NULL,
  n INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, vol_tier)
);
```

**Backend change:** `dynamic_deadline.py` writes to this table after each reopt cycle.

### Phase 3 — Frontend: Extend Dashboard Data Bundle

#### 3.1 Extend `/api/dashboard-data` route

Add new fields to the response:

```javascript
// In loadLiveBundle() and loadCachedBundle():
const [deadlineRes, geometryRes, pivotRes] = await Promise.all([
  supabase.from("v_talaria_deadline_tiers").select("*"),
  supabase.from("v_talaria_geometry_risk").select("*"),
  supabase.from("v_talaria_kairos_pivots").select("*"),
]);

return {
  // ... existing fields ...
  deadlineTiers: safeData(deadlineRes),
  geometryRisk: safeData(geometryRes),
  kairosPivots: safeData(pivotRes),
};
```

#### 3.2 Extend `v_talaria_latest_signals` consumption

The sweeps already contain the new Kairos columns (from Phase 1.1). Update the dashboard to display them.

### Phase 4 — Frontend: New Dashboard Sections

#### 4.1 Signal Context Card (new component)

A card showing the full Kairos context for the selected symbol's latest signal:

```
┌─ Signal Context ─────────────────────────────────────┐
│ BTCUSD · BUY · low_vol_bull                          │
│                                                       │
│ Entry: $104,250.00                                    │
│ SL:   $103,502.50  (3 bricks · 0.748)               │
│ TP:   $105,745.00  (6 bricks · 0.748)               │
│                                                       │
│ ── Dynamic ATR ──                                     │
│ TP/SL: 8.07 ATR / 1.77 ATR                           │
│ Expectancy: +0.82 ATR · Expiry: 12%                  │
│ Vol ratio: 0.71 (low-vol gate)                       │
│                                                       │
│ ── Deadline ──                                        │
│ Soft: 24h · Hard: 48h · Median: 18h                  │
│ Confidence: high (n=142)                              │
│                                                       │
│ ── Geometry Risk ──                                   │
│ Long-lag: 18% · Risk score: 0.22                     │
│ P90 resolution: 36h                                   │
│                                                       │
│ ── Regime Freshness ──                                │
│ Event window: fresh (2.3h since transition)           │
│ Transition: dir_flip                                  │
│ Rank score: 0.72                                      │
│                                                       │
│ ── Macro Pivot ──                                     │
│ FOMC Rate Decision · major_pivot · intensity 0.85     │
│ "Fed signals higher-for-longer stance"                │
└───────────────────────────────────────────────────────┘
```

#### 4.2 Renko Chart Fix

Fix the brick grid matching in `RenkoSection`:

```javascript
// Current (buggy):
function pickLiveGridBricks(renkoBricks, symbol, sweepRow) {
  const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === symbol);
  if (!sweepRow || !(Number(sweepRow.brick_size) > 0)) {
    return [...symbolBricks].sort(/*...*/);
  }
  const live = symbolBricks.filter((b) =>
    brickSizeMatches(b.brick_size, sweepRow.brick_size)
  );
  return live.sort(/*...*/);
}

// Fixed: also filter by session_date and add fallback
function pickLiveGridBricks(renkoBricks, symbol, sweepRow) {
  const symbolBricks = (renkoBricks || []).filter((b) => b.symbol === symbol);
  if (!sweepRow || !(Number(sweepRow.brick_size) > 0)) {
    return [...symbolBricks].sort(/*...*/);
  }
  // Filter by brick_size AND session_date (latest session only)
  const latestSession = symbolBricks.reduce((max, b) =>
    b.session_date > max ? b.session_date : max, ""
  );
  const live = symbolBricks.filter((b) =>
    brickSizeMatches(b.brick_size, sweepRow.brick_size) &&
    b.session_date === latestSession
  );
  // Fallback: if no bricks match the live grid, show a warning
  if (live.length === 0) {
    console.warn(`[Renko] ${symbol}: no bricks on live grid (bs=${sweepRow.brick_size}, session=${latestSession})`);
    return [];
  }
  return live.sort(/*...*/);
}
```

#### 4.3 ATR Scale Indicator

Add a small indicator next to the brick_size label showing the ATR scaling:

```javascript
// In RenkoSection, next to "grid bs={fmtBrickSize(sweepRow.brick_size)}":
{sweepRow.brick_vol_scale != null && (
  <span className="text-xs opacity-60">
    · ATR scale: {sweepRow.brick_vol_scale.toFixed(3)}
    {sweepRow.vol_ratio != null && ` · vol_ratio: ${sweepRow.vol_ratio.toFixed(2)}`}
  </span>
)}
```

### Phase 5 — Frontend: Calibration Scorecard

Add a calibration scorecard section showing:

- **No-skill line** vs **actual accuracy** by regime cell
- **Calibration error** (p_win - actual) by era
- **Rank IC** (Spearman correlation between rank score and outcome)

Data source: `nt_signal_sim` (already has `kairos_rank_score`, `outcome`, `tp_first`, `tp_distance_atr`, `sl_distance_atr`).

---

## 6. Renko Brick Harmonization — Detailed Fix

### 6.1 Problem

The `brick_size` in `nt_sweep_result` is the **ATR-scaled value** (e.g., `0.748` for BTCUSD), but the YAML base is `250.0`. The frontend has no way to know this scaling happened or why.

### 6.2 Fix

1. **Backend:** Persist `brick_vol_scale` and `vol_ratio` alongside `brick_size` in `nt_sweep_result`.
2. **Backend:** Add `base_brick_size` (the YAML value before scaling) to `nt_sweep_result`.
3. **Frontend:** Display the scaling factor and base value in the renko chart label.
4. **Frontend:** Fix `pickLiveGridBricks()` to filter by `session_date` (latest session only).
5. **Frontend:** Add a "grid mismatch" warning when bricks don't match the sweep's `brick_size`.

### 6.3 Migration

```sql
-- Add columns to nt_sweep_result (no backfill — new sweeps populate going forward)
ALTER TABLE nt_sweep_result
  ADD COLUMN IF NOT EXISTS base_brick_size FLOAT,
  ADD COLUMN IF NOT EXISTS brick_vol_scale FLOAT,
  ADD COLUMN IF NOT EXISTS vol_ratio FLOAT;
```

**No backfill required.** Existing rows will have NULL for these columns. The frontend handles NULL gracefully (hides the ATR indicator, falls back to `generateBricks`). New sweeps populate all three fields.

---

## 7. Build Plan (Ordered)

| Step | Repo | Change | Verify |
|---|---|---|---|
| B1 | fastapi-backend | Add `base_brick_size`, `brick_vol_scale`, `vol_ratio` to `nt_sweep_result` | Migration applies |
| B2 | fastapi-backend | Persist these fields in `log_sweep_result()` | Unit test |
| B3 | fastapi-backend | Create `nt_deadline_tiers` table + write from `dynamic_deadline.py` | Migration + test |
| B4 | fastapi-backend | Extend `v_talaria_latest_signals` with Kairos columns | View query test |
| B5 | nobletradingapp | Create `v_talaria_deadline_tiers`, `v_talaria_geometry_risk`, `v_talaria_kairos_pivots` views | Migration applies |
| B6 | nobletradingapp | Extend `/api/dashboard-data` to serve new fields | API test |
| B7 | nobletradingapp | Fix `pickLiveGridBricks()` session_date filter | lint + manual chart test |
| B8 | nobletradingapp | Add Signal Context card component | lint + build |
| B9 | nobletradingapp | Add ATR scale indicator to renko chart | lint + build |
| B10 | nobletradingapp | Add calibration scorecard section | lint + build |

---

## 8. Files to Touch

### Backend (`noble-trader-fastapi-backend`)

| File | Change |
|---|---|
| `regime_platform/sweep_orchestrator/supabase_client.py` | Add `base_brick_size`, `brick_vol_scale`, `vol_ratio` to `NT_SWEEP_RESULT_COLUMNS` |
| `regime_platform/sweep_orchestrator/orchestrator.py` | Populate new fields in sweep payload |
| `regime_platform/sweep_orchestrator/dynamic_deadline.py` | Write to `nt_deadline_tiers` table |
| `supabase/migrations/NNN_add_kairos_fields.sql` | New migration |

### Frontend (`nobletradingapp`)

| File | Change |
|---|---|
| `supabase/migrations/00NN_kairos_views.sql` | New views |
| `app/api/dashboard-data/route.js` | Serve new fields |
| `app/dashboard/page.jsx` | Signal Context card, ATR indicator, renko fix |
| `app/components/signal-context-card.jsx` | New component |
| `app/components/calibration-scorecard.jsx` | New component |

---

## 9. Verification Checklist

```bash
# Backend
cd noble-trader-fastapi-backend
PYTHONPATH="$PWD/src" ./.venv/Scripts/python.exe -m pytest tests/ -q -p no:cacheprovider

# Frontend
cd nobletradingapp
npm run lint
npm run build
```

**Live smoke:**
1. For BTCUSD: `nt_sweep_result.base_brick_size` = 250.0, `brick_vol_scale` ≈ 0.003, `brick_size` ≈ 0.748
2. Dashboard renko chart: bricks and ENTRY/SL/TP lines on same price plane
3. Signal Context card shows deadline tiers, geometry risk, ATR scale
4. Calibration scorecard shows no-skill vs actual accuracy

---

## 10. Decision Log

| Date | Decision |
|---|---|
| 2026-10-05 | Assessment complete: 15+ Kairos modules identified, most fields not surfaced on frontend |
| 2026-10-05 | Renko brick bug root cause: ATR-scaled brick_size + stale grid/session mismatch |
| 2026-10-05 | Plan: extend views → extend API → new dashboard components |
| 2026-10-05 | Deadline tiers: move from `nt_roadmap` JSON to proper `nt_deadline_tiers` table |
