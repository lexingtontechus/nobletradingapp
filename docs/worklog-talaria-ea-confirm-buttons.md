# Worklog — Talaria Copy EA: chart BUY/SELL confirm (2026-09-29)

**Status:** BUILT (local) · `eas/TalariaCopy.mq5` + `public/talaria/`  
**Mode:** `OTC_MODE_CONFIRM` (new default for copy UX)

---

## 1. Why

Qualified signals fire unattended. Traders want a **one-click confirm** on the
chart when a signal arrives — not naked `Buy(0.01)`, and not a second
auto-executor.

Reference pattern (`mql5tutorial.com` chart buttons) is fine for a demo; we
already have chart objects + `OnChartEvent` (Pause / Close all). We extend
**that** system instead of `CButton` + `OnTick` polling.

## 2. Behaviour

| Mode | Order on signal | Chart buttons |
|---|---|---|
| **Shadow** | Never | Preview only (log) |
| **Confirm** (new) | Only after **BUY** / **SELL** click | Light the matching side with entry/SL/TP/lots |
| **Live** | Auto immediately | Shown as “already copied” (disabled) |

### Confirm flow

1. Qualified signal → store **one** pending slot (latest wins).
2. Draw `OTC_BTN_BUY` / `OTC_BTN_SELL` (only the signal side enabled) + label.
3. Click → same sizing + SL/TP path as Live (`ComputeLots`, `MqlTradeRequest`).
4. `ConfirmTimeoutSec` (default 120) → expire, grey out, never fire stale.
5. Paused / not entitled / max positions → no order on click.

## 3. Safety

- Buttons use **signal SL/TP + risk lots** — never a default 0.01 market order.
- `MagicNumber` unchanged → Close all still matches.
- Idempotent `StateAdd(uid)` after trade/expiry.
- `EnableTrading=false` still blocks real orders (preview only).

## 4. Files

| File | Change |
|---|---|
| `eas/TalariaCopy.mq5` | `OTC_MODE_CONFIRM`, pending slot, BUY/SELL buttons, timeout |
| `eas/TalariaCopy.set` | `Mode=2` (Confirm) |
| `public/talaria/*` | synced |
| `bridge/README.md` | optional note — EA confirm mode |

## 5. Verify

1. Shadow → buttons appear, click logs only.
2. Confirm + EnableTrading → click BUY/SELL sends one order with SL/TP.
3. Ignore buttons → expire after `ConfirmTimeoutSec`, no order.
4. Pause / lapsed claim → click does not trade.

## 6. Decision log

| Date | Decision |
|---|---|
| 2026-09-29 | Implement Confirm mode with chart BUY/SELL (not `CButton` demo code). |
