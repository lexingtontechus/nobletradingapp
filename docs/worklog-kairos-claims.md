# Kairos claims layer — frontend contract & rendering plan

**Date:** 2026-10-27
**Type:** Design (companion to `noble-trader-fastapi-backend/worklog/20261027_KAIROS_CLAIMS_LAYER_DESIGN.md` — read that first for the backend contract, phases, and non-goals).
**Scope:** Frontend only. No backend files changed here. Phase C of the claims layer.

---

## 0. The disconnect this closes

The dashboard currently renders signals as **point values**: ENTRY/SL/TP copy buttons and three
horizontal lines (`FloatingSignalsWidget`, `RenkoSection`), plus a **claimed** win%
(`KellyTable`, `SignalRankingBoard`, `p_win` chip). Calibration honesty exists but lives on
separate tabs (`CalibrationScorecard`, `CalibrationConfidenceBoard`, Edge Lab). The distributional
context — the only layer the TSFM lab measured as honest — never reaches the signal card. Also
unrendered despite being in the bundle: `deadlineTiers`, `geometryRisk`, `kairosPivots`
(`loadCachedBundle`), and the planned `SignalContextCard` from
`docs/worklog-kairos-frontend-harmonization.md` §4.1.

## 1. What arrives (backend → frontend)

Claim fields ride the existing `signal` broadcast event as an optional `claim` object
(fail-open, omitted when None), and join `v_talaria_latest_signals` / the
`/api/dashboard-data` bundle for REST:

```js
claim: {
  claim_id, signal_id, ts, deadline_ts,
  kind: "bracket" | "vol_fan" | "thesis",
  source: "tsfm_sidecar" | "vol_backtest_recalib" | "manual",
  horizon_h,
  fan: [{ h, t, q05, q10, q25, q50, q75, q90, q95 }],   // PRICE space, matches entry/sl/tp units
  bracket_ref: { entry, sl, tp, tp_q, sl_q },            // bracket positions inside the fan
  claimed_probs: { p_resolve, p_win_given_resolve, pi_win, pi_loss }
}
```

Units note: the fan is **always price space** at this boundary — the backend converts once at
registration. The frontend must never rescale or exponentiate. (This was the lab's own fan-axis
bug class; the contract removes it by construction.)

## 2. Lockstep consumers (the 0029/0029-style checklist)

1. **Matview/view**: extend `v_talaria_latest_signals` (or sibling `v_talaria_signal_claims`) —
   `CREATE OR REPLACE` + dependent view rebuild + `GRANT SELECT ... TO anon, service_role`.
2. **`/api/dashboard-data`**: add claims to **both** `loadCachedBundle` and `loadLiveBundle`, and to
   the `talaria_dashboard_cache` JSONB payload (refreshed by backend pg_cron — cache and live
   payloads must match or cold-start diverges).
3. **Broadcast handler** (`app/dashboard/page.jsx` subscription block): absorb `claim` with the
   dual-name fallback-getter pattern (`rankOf`/`stateOf` precedent). Remember: supabase-js
   prepends `realtime:` — subscribe to `signals.${planSlug}` without the prefix.
4. **MT5 consumers stay untouched**: `talaria-copy` `SIGNAL_COLUMNS` and the EA/bridge keep the
   minimal entry/sl/tp contract by design.

## 3. Rendering plan

| Surface | Addition |
|---|---|
| **`SignalContextCard`** (new, host of the harmonization backlog) | Reusable fan SVG — port the `components/tsfm-lab/fan-chart.tsx` precedent (it already accepts `history`/`fan`/interval chips and draws price axes with magnitude-aware ticks) — with ENTRY/SL/TP drawn as labeled lines **on** the fan, plus the unrendered `deadlineTiers`/`geometryRisk`/`kairosPivots` context. |
| `FloatingSignalsWidget` | One chip when a claim exists: "TP q92 · SL q18" (bracket-in-fan position; tooltip: "bracket levels as quantiles of the registered 24h fan"). |
| `KellyTable` / `SignalRankingBoard` | Optional `Cov 80%` column (resolved-claim rolling coverage per symbol) next to Claimed win% — honesty beside the claim, not behind a tab. |
| Existing calibration surfaces | Unchanged; claim outcomes feed the same badge vocabulary (CALIBRATED/OVERCONFIDENT/...). |

Copy rules: "Claimed win%" stays claimed; fan coverage is reported as measured
("80% band caught 79%"); never render `p_win` and fan coverage as the same kind of number.

## 4. Non-goals

No transport rewrite (Supabase Realtime stays), no new subscriptions, no EA changes, no chart
embed changes. The card is additive; without a claim, every surface renders exactly as today.
