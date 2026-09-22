# L1 calibration confidence board (dashboard/admin surface)

> **Date:** 2026-09-22 · **Build Code** authorized · ships with backend migration 160  
> **Repo role:** dashboard / admin / frontend for noble-trader  
> **Companion:** `noble-trader-fastapi-backend/worklog/20260922_BUILD_L1_CALIBRATION_CONFIDENCE_BOARD.md`  
> **Spec:** `noble-trader-fastapi-backend/worklog/20260922_L1_CONFIDENT_CALIBRATION_RECOMMENDATIONS.md`

## Scope

This change **includes** the L1 product surface in this repo (not a separate deferred worklog): the dashboard must answer “is p_win honest?” without blending buy/sell or hiding thin episodes.

## UI / API

### Analysis tab

1. **L1 calibration confidence (28d)** — new `CalibrationConfidenceBoard`
   - One row per `(symbol, side)` from `v_calibration_confidence_board`
   - Columns: episodes, **p_dir raw**, win closed, **bias raw**, Brier, expire, **status_l1**
   - Tightened status badges: CALIBRATED / PROVISIONAL / OVERCONFIDENT / UNDERCONFIDENT / UNCERTAIN
   - High expire (>40%) blocks CALIBRATED and is called out (geometry, not product win%)
2. **Calibration bias (7d)** — existing symbol-level table, copy updated to defer to the L1 board and note direction-confidence framing.

### Portfolio tab (unchanged surface)

- Concurrent-signal **pairs matrix** remains the buy-vs-sell product demonstration on commentary/plan symbols (`PairList` + agreement matrix).
- **VsEqualWeightTable** copy now warns that equal-wt research-stream units are not commensurate with paper notional — Delta is context, not product edge.

### `/api/dashboard-data`

New response keys (plan-symbol filtered):

| Key | Source |
|---|---|
| `calibrationBoard` | `v_calibration_confidence_board` |
| `outcomeBySide` | `v_signal_outcome_by_side` where `qualified=true` |

Graceful empty arrays if views are not deployed yet.

## Language (R1)

- UI states stated confidence is **direction confidence (`p_dir`)** until `p_win_bracket` is live.
- Product quality = paper book + calibration honesty — **not** EOD win%/expiry.

## Files

| Path | Change |
|---|---|
| `app/api/dashboard-data/route.js` | + calibrationBoard, outcomeBySide |
| `app/dashboard/page.jsx` | + CalibrationConfidenceBoard; copy updates |

## Verify

```bash
npx eslint app/dashboard/page.jsx app/api/dashboard-data/route.js
```

After backend migration 160 applies: open Dashboard → Analysis → L1 board fills; Portfolio pairs matrix unchanged.

## Still open (follow-ups, not this change)

- Unit-aligned paper vs equal-weight baseline (same $ notional / cohort)
- `p_win_bracket` live gate + EV (backend R2)
- Cell-level enforcement (backend R3)
