# Worklog — Talaria Signal Copy: WebSocket push (Option A)

**Date:** 2026-09-29  
**Decision:** Option A — EA connects to **Supabase Realtime** with **anon (publishable) credentials**, same push path as the desktop plugin / web dashboard.  
**Status:** Designed + EA/gateway path built (local). REST poll remains fallback.

---

## 1. Why not REST-only

Light sweeps write signals every **~15 min**. A pull loop either:
- polls often enough for “live” feel and hammers the gateway, or
- polls sparsely and is not push.

The platform is **push-first**: `realtime_publisher.py` already broadcasts on
`realtime:signals.<plan_slug>` (Phoenix / Supabase Realtime). Plugin + web
subscribe that channel. The EA should too.

## 2. MQL5 WebSocket — what is true

| Claim | Reality |
|---|---|
| `WebRequest` is streaming | **No** — blocking full-body HTTP |
| MQL5 cannot WebSocket | **False** |
| Pure MQL5 WS | **Yes** — `SocketCreate`/`SocketConnect` + RFC 6455 |
| WSS / TLS | **Needs care** — `Socket*` is raw TCP; TLS via Windows WinHTTP/WinINet (DLL) or equivalent |
| DLL path | e.g. `asyncwinhttpwebsockets.dll` (async WinHTTP WS) |

**Option A target transport:** `wss://<host>/realtime/v1/websocket?apikey=<anon>&vsn=1.0.0`
(Phoenix, object JSON frames — same as `plugin.js` `realtimeWsUrl` / `parseRealtimeMessage`).

## 3. Security (Option A)

| Surface | Policy |
|---|---|
| Anon / publishable key | Same value as desktop plugin (`DEFAULT_ANON_KEY`). Public; RLS + **topic ACL** (`signals.<plan_slug>`) gate data |
| Claim token | Still required for `talaria-copy` handshake + REST fallback (identity) |
| Supabase service key | **Never** in EA |
| Entitlement | Handshake TTL (`period_end` / `HandshakeIntervalSec`) — identity every call, subscription not re-joined per frame |

## 4. Protocol (mirror plugin.js)

Connect:
`wss://…/realtime/v1/websocket?apikey=<apikey>&vsn=1.0.0`

Join:
```json
{
  "topic": "realtime:signals.<plan_slug>",
  "event": "phx_join",
  "payload": { "config": { "broadcast": { "self": false, "ack": false } } },
  "ref": "1"
}
```

Broadcast (server → EA):
```json
{
  "event": "broadcast",
  "payload": { "type": "broadcast", "event": "signal", "payload": { … } }
}
```

Heartbeat every ~30s:
```json
{ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "…" }
```

## 5. Handshake payload (gateway)

`talaria-copy` **handshake** now returns flat Realtime fields for the EA’s JSON scanner:

| Field | Meaning |
|---|---|
| `realtime_url` | `wss://…/realtime/v1/websocket` |
| `realtime_apikey` | anon / publishable key |
| `realtime_topic` | `realtime:signals.<plan_slug>` |

EA builds the full WS URL (`?apikey=…&vsn=1.0.0`) and joins `realtime_topic`.

## 6b. DLL install (2026-09-29 — no third-party download)

**Do not use `asyncwinhttpwebsockets.dll`.** It is not a standard MT5 component; there is no official download surface we can put in front of customers.

**Transport = Windows inbox `winhttp.dll`** (`TalariaRealtime.mqh` `#import`).

| Step | User action |
|---|---|
| 1 | Copy `TalariaCopy.mq5` + `TalariaRealtime.mqh` → `MQL5\Experts\` |
| 2 | **Tools → Options → Expert Advisors** → check **Allow DLL imports** (off by default) |
| 3 | Optional: also allow listed URLs for the Supabase host under “Allow WebRequest for listed URL” if REST fallback is used |
| 4 | Attach EA; `TransportMode = WS push` |

If DLL imports stay off: journal shows `Allow DLL imports` hint → **REST fallback** still trades.

Security: only system `winhttp.dll` is loaded. No customer-downloaded binaries.

## 6d. Scale fix — Python bridge (2026-09-29) — REST poll removed

**Problem:** REST `action=poll` per EA is a database drain (500+ users × poll interval).

**Architecture (production):**

```text
Supabase Realtime (one WS per bridge, plan topic)
        ↓ push
talaria_bridge.py  (local Windows process)
        ↓ MetaTrader5 Python API (IPC to terminal)
   MT5 terminal / broker
```

- `nobletradingapp/bridge/` — `talaria_bridge.py`, `config.json`, `requirements.txt`
- Handshake only for claim / entitlement TTL (12h) — **not** on the signal path
- No gateway poll loop; no MQL5 DLL requirement for signals
- MQL5 EA remains optional (shadow/tools); **do not** scale REST poll to customers

**MetaTrader5 package is Windows-only** — run the bridge beside the terminal (PC or Windows VPS).

## 6e. macOS (corrected 2026-09-29)

**Mac MT5 is supported** — [MetaTrader 5 on the App Store](https://apps.apple.com/us/app/metatrader-5/id413251709) and **Plexytrade**.

| Layer | Windows | macOS |
|---|---|---|
| MT5 terminal | Yes | **Yes** (App Store / Plexytrade) |
| Python `MetaTrader5` package | Yes (`mt5.order_send`) | **No** (Windows-only IPC) |
| Execution | Python bridge **or** MQL5 EA | **MQL5 EA** (`TalariaCopy.mq5`) in Mac MT5 |
| Signal push | Supabase Realtime WS | Same WS (Python or EA path) |

Do not tell customers Mac MT5 is unsupported. The gap is only `import MetaTrader5` on Mac.

| | Windows | macOS |
|---|---|---|
| MT5 build | Native | Usually Windows terminal under **Wine** |
| Push (WSS / WinHTTP) | Supported (Allow DLL imports) | **Not supported** |
| **REST poll** | Fallback | **Primary** |
| Setup | Allow DLL imports | Allow **WebRequest** for Supabase host; `TransportMode = REST poll` |
| DLL download | None (inbox `winhttp.dll`) | None |

`TalariaOsIsWindows()` / `TalariaOsIsMacLike()` gate WS attempts so Mac never calls WinHTTP. REST = EA `OnTimer` HTTPS `action=poll` every `PollIntervalSec` (10 min default; light sweep ~15 min).

| `TransportMode` | Behaviour |
|---|---|
| `OTC_TRANSPORT_WS_PUSH` | WS primary (Phoenix join + onMessage → same signal path as REST poll). Sparse REST **fallback** if WS down |
| `OTC_TRANSPORT_REST_POLL` | Current sparse HTTPS poll (default until WS DLL/machine verified) |

WS stack lives in `eas/TalariaRealtime.mqh` (Phoenix encode/decode + session).  
TLS socket: WinHTTP WebSocket DLL (`asyncwinhttpwebsockets.dll`) or compatible; if the DLL is missing the EA logs and falls back to REST.

## 7. Files

| File | Change |
|---|---|
| `supabase/functions/talaria-copy/index.ts` | handshake returns `realtime_url` / `realtime_apikey` / `realtime_topic` |
| `eas/TalariaRealtime.mqh` | Phoenix client (join/heartbeat/broadcast parse) + WS session |
| `eas/TalariaCopy.mq5` | `OTC_TRANSPORT_WS_PUSH`, wire realtime into handshake + OnTimer |
| `public/talaria/*` | synced copies |
| Portal panel / scoping notes | WS push + REST fallback + entitlement TTL |

## 8. Verification

1. Handshake response contains realtime_* fields (curl `talaria-copy`).
2. EA `TransportMode=WS_PUSH` connects, journal shows `phx_join` reply.
3. Fire a qualified signal → EA log/trade without waiting for poll interval.
4. Kill WS (or omit DLL) → fallback REST still delivers within `PollIntervalSec`.
5. Revoked claim → handshake/poll 401; WS may deliver until TTL — EA must stop trading on 401 / `entitled_until` past.

## 9. Decision log

| Date | Decision |
|---|---|
| 2026-09-29 | Reject “MT5 cannot WS”. **Option A** — Supabase Realtime + anon key (plugin parity). REST = fallback. Entitlement = handshake TTL. |
