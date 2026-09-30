# Talaria Signal Copy — Python bridge

Local process on the trader's machine (Windows + MetaTrader 5).  
**No REST polling. No per-user gateway hammering.**

```text
Supabase Realtime  (push, one WS per bridge)
   wss://…/realtime/v1/websocket?apikey=<anon>
   topic: realtime:signals.<plan_slug>
        │
        ▼
talaria_bridge.py  (this package)
        │  MetaTrader5 Python API (local IPC to terminal)
        ▼
   MT5 terminal  →  broker orders
```

| | |
|---|---|
| Signal path | **WebSocket push** (same channel as desktop plugin / web) |
| Execution | `MetaTrader5` package (`mt5.order_send`) — local socket/IPC |
| Claim token | Handshake only (identity + entitlement TTL) — **not** every signal |
| REST poll | **Removed** (scale: 500+ users would stampede the DB) |

## Requirements

| | Windows | macOS |
|---|---|---|
| **MT5 terminal** | Yes | **Yes** — [MetaTrader 5 (App Store)](https://apps.apple.com/us/app/metatrader-5/id413251709) · **Plexytrade** supports Mac |
| **Where everything runs** | Same PC | **Same Mac — no VPS** |
| Signal push | Supabase Realtime WS | Same |
| Execution | `MetaTrader5` package **or** local EA | **Local EA** + bridge `localhost` push |

```text
Python 3.10+
MT5 terminal on this machine
pip install -r requirements.txt
```

## Transport (both platforms)

| Order | Path | Cadence |
|---|---|---|
| **1. Primary** | WebSocket → `realtime:signals.<plan>` | Push (instant) |
| **2. Backup** | REST `action=poll` | Every **10 min** (`backup_poll_sec: 600`) |

Windows **and** macOS use this same order. Backup poll is a safety net (missed frames / WS down) — not a tight loop.

```text
Supabase Realtime ──WS──► talaria_bridge.py ──127.0.0.1:8765──► TalariaCopy EA
                              (Mac or PC)         local TCP         Mac/Win MT5
```

1. Run `python talaria_bridge.py --mode live` on the **same computer** as MT5.
2. In the EA: `TransportMode = Local push`, `LocalPort = 8765`.
3. EA `SocketConnect`s to `127.0.0.1` (pure MQL5 — **no DLL**, **no REST poll**).

Windows may also use `MetaTrader5` Python `order_send` and skip the EA.

**We never recommend a VPS.**

## Install

```bash
cd bridge
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

1. Portal → **Talaria Signal Copy** → *Reveal claim token* → **Download .txt** → save as `otc_token.txt` in this folder (or set `TALARIA_CLAIM_TOKEN`).
2. Edit `config.json` (risk, symbol map, mode shadow/live).
3. Start MT5 and log in to your account.
4. Run:

```bash
python talaria_bridge.py
```

## config.json

| Key | Default | Meaning |
|---|---|---|
| `endpoint` | `https://…supabase.co/functions/v1/talaria-copy` | Handshake only |
| `token_file` | `otc_token.txt` | Claim token (one line) |
| `mode` | `shadow` | `shadow` = log only · `live` = `order_send` |
| `risk_percent` | `0.5` | % equity risk per signal |
| `max_lots` | `1.0` | Cap |
| `magic` | `20260908` | EA magic for this bridge |
| `symbol_map` | `{}` | `XAUUSD` → broker symbol e.g. `XAUUSDm` |

## Entitlement

- **Handshake** (startup + every `handshake_interval_sec`, default 12h): claim + live subscription → `plan_slug`, `entitled_until`.
- **Every WS frame:** no DB subscription re-read (push is fan-out, not a query per user).
- Revoked/expired claim → next handshake fails → bridge stops trading.

## Why not REST poll

Light sweep ~15 min. Polling at 500 users × N endpoints = constant PostgREST load for no new data. One broadcast frame hits all bridges on the plan topic.
