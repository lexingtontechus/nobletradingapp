# Worklog: Renko Chart TP/SL Bug + Polling/Toast Fixes — 2026-08-31

## Summary

The dashboard's Renko chart shows incorrect TP/SL for all subscribed symbols
(xauusd, xaueur, usdcad, usdchf, usdjpy, us30usd, us500). Two root causes
compound each other, plus a secondary polling-rate issue and a toast-notification
failure. All four fixes are applied and verified (`npm run lint` = 0 errors,
`npm run build` passes).

## Root Cause 1 — `generateBricks` direction mismatch (PRIMARY)

`generateBricks()` (line 344) is the fallback brick generator used when no
real renko brick data (`nt_renko_bricks`) has arrived yet. It destructures
`signal` from `sweepRow` and computes `isBuy` from that alone:

```js
const { brick_size, entry_price, signal } = sweepRow;
const isBuy = String(signal || "").toLowerCase() !== "sell";
```

When a realtime signal arrives (`direction` field, no `signal` field),
`sweepRow.signal` is `undefined` → `isBuy = true` → bricks always generate
**upward**. For a SELL signal the SL line is above entry and TP is below
entry, so the upward bricks fly directly into the SL line — visually making
TP/SL appear swapped/wrong even though `sweepRow.stop_loss` and
`sweepRow.take_profit` values are correct.

The brick values (`entry_price`, `stop_loss`, `take_profit`) come from the
backend's `_derive_trade_signal()` which is correct. The `levels` reference
lines (ENTRY / SL / TP) are drawn from those correct values. The bug is
purely in the brick **direction**, making the chart visually misleading.

## Root Cause 2 — `signal` vs `direction` field duality

The noble-trader backend has two parallel representations of the same
signal direction, with different field names in different data sources:

| Data source | Field name | Values | Where |
|---|---|---|---|
| REST API (`v_talaria_latest_signals` → `nt_sweep_result`) | `signal` | `"buy"` / `"sell"` / `"neutral"` | Column `signal` in `nt_sweep_result` |
| Realtime broadcast (`build_signal_payload` in `orchestrator.py`) | `direction` | `"buy"` / `"sell"` / `"neutral"` | Top-level key in the broadcast payload |

The `nt_sweep_result` table stores direction in a column called `signal`.
The broadcast payload sends it as `direction`. The dashboard merges both
via `mergedSweeps = [liveSignals, ...fetchedSweeps]`, so a single symbol
row may have `signal` (from REST) or `direction` (from realtime).

The prior fixes (commits `1937238` and `1c6295c`) fixed the Realtime handler
and `RenkoSection` `isBuy`, but missed `generateBricks`, `MarkovSection`,
and `KellyTable`.

## Fixes Applied (all in `app/dashboard/page.jsx`)

1. **`generateBricks`** (line 344) — added `direction` to destructuring,
   changed `String(signal || "")` → `String(signal || direction || "")`.
2. **`MarkovSection`** (line 657) — `sweepRow.signal === "buy"` →
   `String(sweepRow.signal || sweepRow.direction || "").toLowerCase() === "buy"`.
3. **`KellyTable`** (line 924) — `r.signal || "—"` →
   `String(r.signal || r.direction || "") || "—"`.
4. **Poll interval** (line 1497) — changed `60000` → `300000` (60s → 5min).
5. **`pushToast` stabilization** — wrapped in `useCallback(..., [])` so the
   function reference is stable and the Realtime effect doesn't re-subscribe
   on every render (which was silently dropping broadcasts and toasts).

## Root Cause 3 — Toast notification not firing

The toast fires inside the Realtime broadcast handler (line 1434).
`pushToast` was a plain function inside `useToasts()`, not memoized with
`useCallback`. The `useEffect` at line 1398 had `pushToast` in its
dependency array (`[planSlug, pushToast]`). Because `pushToast` changed
reference on every render, the effect tore down and re-subscribed the
Realtime channel on every render cycle. During the unmount/remount gap,
broadcasts were silently dropped — including the `pushToast` call.

The dashboard still showed "Live" because `wsStatus` only downgrades on
explicit error/timeout states, never reverts to `"connecting"` once it
hit `"connected"`. So the UI lied about the connection being stable
while the channel was mid-reconnect.

**Fix:** Wrapped `pushToast` in `useCallback` with empty deps. `setToasts`
(the state setter from `useState`) is already guaranteed stable by React,
so `useCallback(..., [])` is safe.

## Poll Interval Change (60s → 5min)

The poll fallback ran every 60 000 ms. The user requested 5 minutes
(300 000 ms) to reduce backend load. The plugin uses `PANE_TICK_MS = 30s`.

## Verification

```bash
npm run lint  # 0 errors, 9 pre-existing warnings
npm run build # all routes compiled successfully
```

No git push made. Worklog saved at `docs/worklog-renko-chart-tp-sl-bug.md`.

## See Also

- `docs/worklog-renko-chart-tp-sl-bug.md` — full triage report with
  the `signal` vs `direction` duality table and all known affected locations
- `nextjs-subscription-gate-redirect/references/renko-chart-sl-tp-validation.md`
  — SL/TP data validation and the canonical `signal || direction` normalization pattern
- `noble-trader-plugin-build/references/signal-direction-normalization.md`
  — same pattern, plugin-side context