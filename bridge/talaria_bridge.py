#!/usr/bin/env python3
"""
Talaria Signal Copy — Python bridge (2026-09-29)

Push-only signal path:
  Supabase Realtime (Phoenix WS)  →  this process  →  MetaTrader5 API  →  terminal

No REST signal polling. Handshake (claim + entitlement TTL) is infrequent.
Scale: one WS per bridge on realtime:signals.<plan_slug> — no per-user DB query
per sweep.

Windows-only: MetaTrader5 package talks to the local terminal via IPC.

Usage:
  python talaria_bridge.py [--config config.json] [--mode shadow|live]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import requests

try:
    import websockets
except ImportError:
    print("pip install websockets", file=sys.stderr)
    raise

log = logging.getLogger("talaria.bridge")

DEFAULT_ENDPOINT = (
    "https://pcvscowltlrxzgxjurcr.supabase.co/functions/v1/talaria-copy"
)
DEFAULT_ANON_KEY = "sb_publishable_cYfseJa9z0qss0g_Y594wA_lXrWVBsa"
DEFAULT_HEARTBEAT = 30
DEFAULT_HANDSHAKE_SEC = 43200


@dataclass
class BridgeConfig:
    endpoint: str = DEFAULT_ENDPOINT
    token_file: str = "otc_token.txt"
    mode: str = "shadow"  # shadow | live
    risk_percent: float = 0.5
    max_lots: float = 1.0
    max_open_positions: int = 5
    magic: int = 20260908
    symbol_map: dict = field(default_factory=dict)
    handshake_interval_sec: int = DEFAULT_HANDSHAKE_SEC
    ws_heartbeat_sec: int = DEFAULT_HEARTBEAT
    # Backup transport (2026-09-29): WS is primary. One REST poll every 10 min
    # catches frames if the socket is down. Not a tight poll loop.
    backup_poll_sec: int = 600
    # Local IPC to TalariaCopy EA (macOS + Windows). No VPS, no tight REST poll.
    local_push_host: str = "127.0.0.1"
    local_push_port: int = 8765
    use_mt5_python: bool = True  # Windows: order_send; False = EA via local push only

    @classmethod
    def load(cls, path: Path, mode_override: Optional[str] = None) -> "BridgeConfig":
        data: dict[str, Any] = {}
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
        cfg = cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        if mode_override:
            cfg.mode = mode_override
        return cfg


@dataclass
class Entitlement:
    plan_slug: str = ""
    plan_uuid: str = ""
    entitled: bool = False
    entitled_until: float = 0.0  # epoch seconds
    realtime_url: str = ""
    realtime_apikey: str = DEFAULT_ANON_KEY
    realtime_topic: str = ""
    realtime_vsn: str = "1.0.0"
    symbols: list = field(default_factory=list)


def load_token(cfg: BridgeConfig) -> str:
    env = os.environ.get("TALARIA_CLAIM_TOKEN", "").strip()
    if env:
        return env
    p = Path(cfg.token_file)
    if not p.is_file():
        raise FileNotFoundError(
            f"Claim token not found: {p}. Portal → Talaria Signal Copy → "
            "Reveal claim token → Download .txt"
        )
    return p.read_text(encoding="utf-8").strip().strip('"')


# ── Handshake (infrequent) ────────────────────────────────────────────────

def handshake(cfg: BridgeConfig, token: str) -> Entitlement:
    """Identity + subscription establishment. Not on the signal path."""
    r = requests.post(
        cfg.endpoint,
        json={"token": token, "action": "handshake"},
        timeout=15,
        headers={"Content-Type": "application/json"},
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise RuntimeError(body.get("error") or "handshake failed")
    ent = Entitlement(
        plan_slug=body.get("plan_slug") or "",
        plan_uuid=body.get("plan_uuid") or "",
        entitled=bool(body.get("entitled")),
        realtime_url=body.get("realtime_url") or "",
        realtime_apikey=body.get("realtime_apikey") or DEFAULT_ANON_KEY,
        realtime_topic=body.get("realtime_topic")
        or (f"realtime:signals.{body.get('plan_slug')}" if body.get("plan_slug") else ""),
        realtime_vsn=body.get("realtime_vsn") or "1.0.0",
        symbols=body.get("symbols") or [],
    )
    until = body.get("entitled_until") or body.get("period_end")
    if until:
        try:
            from datetime import datetime, timezone

            ent.entitled_until = datetime.fromisoformat(
                str(until).replace("Z", "+00:00")
            ).timestamp()
        except ValueError:
            ent.entitled_until = time.time() + cfg.handshake_interval_sec
    else:
        ent.entitled_until = time.time() + cfg.handshake_interval_sec
    return ent


# ── Backup REST poll (every 10 min) — only if WS is down or catch-up ──────

def poll_signals(cfg: BridgeConfig, token: str) -> list[dict]:
    """One talaria-copy poll. Backup path — not the primary feed."""
    r = requests.post(
        cfg.endpoint,
        json={"token": token, "action": "poll"},
        timeout=15,
        headers={"Content-Type": "application/json"},
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise RuntimeError(body.get("error") or "poll failed")
    return body.get("signals") or []


# ── Phoenix / Supabase Realtime (same frames as plugin.js) ────────────────

def realtime_ws_url(ent: Entitlement) -> str:
    base = (ent.realtime_url or "").rstrip("/")
    if not base:
        host = "pcvscowltlrxzgxjurcr.supabase.co"
        base = f"wss://{host}/realtime/v1/websocket"
    elif base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    vsn = ent.realtime_vsn or "1.0.0"
    return f"{base}?apikey={ent.realtime_apikey}&vsn={vsn}"


def phoenix_join(topic: str, ref: str) -> str:
    return json.dumps(
        {
            "topic": topic,
            "event": "phx_join",
            "payload": {"config": {"broadcast": {"self": False, "ack": False}}},
            "ref": ref,
        }
    )


def phoenix_heartbeat(ref: str) -> str:
    return json.dumps(
        {"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": ref}
    )


def parse_broadcast(raw: str) -> Optional[dict]:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(msg, dict):
        return None
    if msg.get("event") != "broadcast":
        return None
    payload = msg.get("payload") or {}
    if payload.get("type") == "broadcast" and payload.get("event") == "signal":
        return payload.get("payload") or {}
    return None


# ── Local IPC hub → TalariaCopy EA (127.0.0.1) ────────────────────────────
# Pure TCP on loopback: EA uses MQL5 Socket* (no TLS, no DLL). One line JSON
# per signal. Same Mac/PC as the terminal — never a VPS.

class LocalPushHub:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self._clients: set = set()
        self._server = None

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_client, self.host, self.port)
        log.info("local push listening %s:%d (EA: TransportMode=Local push)", self.host, self.port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
        for w in list(self._clients):
            try:
                w.close()
            except Exception:
                pass
        self._clients.clear()

    async def _on_client(self, reader, writer) -> None:
        peer = writer.get_extra_info("peername")
        log.info("EA connected %s", peer)
        self._clients.add(writer)
        try:
            while True:
                data = await reader.read(64)
                if not data:
                    break
        except Exception:
            pass
        finally:
            self._clients.discard(writer)
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            log.info("EA disconnected %s", peer)

    async def broadcast(self, signal: dict) -> None:
        if not self._clients:
            return
        line = json.dumps({"type": "signal", "payload": signal}, separators=(",", ":")) + "\n"
        dead = []
        for w in list(self._clients):
            try:
                w.write(line.encode("utf-8"))
                await w.drain()
            except Exception:
                dead.append(w)
        for w in dead:
            self._clients.discard(w)


# ── MetaTrader5 execution ─────────────────────────────────────────────────

class Mt5Executor:
    def __init__(self, cfg: BridgeConfig):
        self.cfg = cfg
        self._mt5 = None

    def connect(self) -> bool:
        try:
            import MetaTrader5 as mt5
        except ImportError:
            log.error("MetaTrader5 not installed (Windows only): pip install MetaTrader5")
            return False
        self._mt5 = mt5
        if not mt5.initialize():
            log.error("mt5.initialize failed: %s", mt5.last_error())
            return False
        info = mt5.account_info()
        log.info(
            "MT5 connected account=%s server=%s balance=%.2f",
            getattr(info, "login", "?"),
            getattr(info, "server", "?"),
            getattr(info, "balance", 0.0),
        )
        return True

    def shutdown(self) -> None:
        if self._mt5 is not None:
            self._mt5.shutdown()

    def broker_symbol(self, canonical: str) -> str:
        return self.cfg.symbol_map.get(canonical, canonical)

    def process_signal(self, sig: dict) -> None:
        mt5 = self._mt5
        if mt5 is None:
            return
        symbol = str(sig.get("symbol") or "")
        side = str(sig.get("signal") or "").lower()
        qualified = bool(sig.get("qualified", True))
        if not symbol or side not in ("buy", "sell") or not qualified:
            return
        entry = float(sig.get("entry_price") or 0)
        sl = float(sig.get("stop_loss") or 0)
        tp = float(sig.get("take_profit") or 0)
        if entry <= 0 or sl <= 0 or tp <= 0:
            return

        broker = self.broker_symbol(symbol)
        log.info(
            "signal %s %s entry=%.5f sl=%.5f tp=%.5f mode=%s",
            symbol,
            side.upper(),
            entry,
            sl,
            tp,
            self.cfg.mode,
        )
        if self.cfg.mode != "live":
            log.info("shadow — no order sent")
            return

        if self.cfg.max_open_positions > 0:
            open_n = len([p for p in (mt5.positions_get() or []) if p.magic == self.cfg.magic])
            if open_n >= self.cfg.max_open_positions:
                log.warning("max_open_positions reached (%d)", open_n)
                return

        tick = mt5.symbol_info_tick(broker)
        info = mt5.symbol_info(broker)
        if tick is None or info is None:
            log.error("unknown broker symbol %s (map it in config.symbol_map)", broker)
            return
        if not info.visible:
            mt5.symbol_select(broker, True)

        price = tick.ask if side == "buy" else tick.bid
        lot = self._lots(info, price, entry, sl)
        if lot <= 0:
            return

        order_type = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": broker,
            "volume": lot,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 20,
            "magic": self.cfg.magic,
            "comment": "TalariaCopy",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(req)
        if result is None:
            log.error("order_send None: %s", mt5.last_error())
            return
        if result.retcode != mt5.TRADE_RETCODE_DONE:
            log.error("order_send retcode=%s comment=%s", result.retcode, result.comment)
        else:
            log.info("order OK ticket=%s volume=%.2f", result.order, lot)

    def _lots(self, info, price: float, entry: float, sl: float) -> float:
        risk = abs(entry - sl)
        if risk <= 0:
            return 0.0
        acc = self._mt5.account_info()
        equity = float(getattr(acc, "equity", 0.0) or 0.0)
        risk_money = equity * (self.cfg.risk_percent / 100.0)
        tick_size = float(getattr(info, "trade_tick_size", 0.0) or 0.0)
        tick_value = float(getattr(info, "trade_tick_value", 0.0) or 0.0)
        if tick_size <= 0 or tick_value <= 0:
            volume = max(float(info.volume_min), 0.01)
            return min(volume, self.cfg.max_lots)
        money_per_lot = (risk / tick_size) * tick_value
        if money_per_lot <= 0:
            return 0.0
        lots = risk_money / money_per_lot
        step = float(info.volume_step or 0.01)
        lots = (int(lots / step) * step) if step > 0 else lots
        lots = max(float(info.volume_min), min(lots, self.cfg.max_lots, float(info.volume_max or self.cfg.max_lots)))
        return round(lots, 2)


# ── Runtime ───────────────────────────────────────────────────────────────

class Bridge:
    def __init__(self, cfg: BridgeConfig):
        self.cfg = cfg
        self.token = load_token(cfg)
        self.ent = Entitlement()
        self.executor = Mt5Executor(cfg)
        self.hub = LocalPushHub(cfg.local_push_host, cfg.local_push_port)
        self._stop = asyncio.Event()
        self._ref = 0
        self._seen: set[str] = set()
        self._ws_up = False

    def stop(self) -> None:
        self._stop.set()

    def _next_ref(self) -> str:
        self._ref += 1
        return str(self._ref)

    def _rehandshake_if_due(self) -> None:
        if time.time() < self.ent.entitled_until and self.ent.realtime_topic:
            return
        log.info("handshake (TTL)")
        self.ent = handshake(self.cfg, self.token)
        if not self.ent.entitled:
            raise RuntimeError(f"not entitled (plan={self.ent.plan_slug})")
        log.info(
            "entitled plan=%s topic=%s until=%.0f",
            self.ent.plan_slug,
            self.ent.realtime_topic,
            self.ent.entitled_until,
        )

    async def run(self) -> None:
        # Local EA push (macOS + Windows) — always on so Mac works without
        # the MetaTrader5 Python package and without any VPS.
        await self.hub.start()
        mt5_ok = False
        if self.cfg.use_mt5_python:
            mt5_ok = self.executor.connect()
            if not mt5_ok:
                log.warning(
                    "MetaTrader5 Python unavailable — trading via local EA only "
                    "(TransportMode=Local push on %s:%d)",
                    self.cfg.local_push_host,
                    self.cfg.local_push_port,
                )
        self._rehandshake_if_due()

        # WS first; backup REST poll every backup_poll_sec (default 600s).
        poll_sec = max(60, int(self.cfg.backup_poll_sec or 600))
        poll_task = asyncio.create_task(self._backup_poll_loop(poll_sec))

        backoff = 5
        while not self._stop.is_set():
            url = realtime_ws_url(self.ent)
            topic = self.ent.realtime_topic
            log.info("WS connect %s topic=%s", url.split("?")[0], topic)
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                    await ws.send(phoenix_join(topic, self._next_ref()))
                    log.info("joined %s (primary=WS, backup poll every %ss)", topic, poll_sec)
                    self._ws_up = True
                    backoff = 5
                    await self._pump(ws)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._ws_up = False
                if self._stop.is_set():
                    break
                log.warning("WS dropped (%s) — backup poll covers until reconnect in %ss", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)
                try:
                    self._rehandshake_if_due()
                except Exception as hs:
                    log.error("handshake failed: %s", hs)
            finally:
                self._ws_up = False
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass
        await self.hub.stop()
        self.executor.shutdown()

    async def _backup_poll_loop(self, interval_s: int) -> None:
        """Every 10 min: REST poll as backup (WS primary on Win + Mac)."""
        await asyncio.sleep(interval_s)
        while not self._stop.is_set():
            status = "WS down" if not self._ws_up else "catch-up"
            try:
                self._rehandshake_if_due()
                signals = await asyncio.to_thread(poll_signals, self.cfg, self.token)
                if signals:
                    log.info("backup poll (%s): %d signal(s)", status, len(signals))
                for sig in signals:
                    await self._deliver(sig)
            except Exception as exc:
                log.warning("backup poll failed (%s): %s", status, exc)
            await asyncio.sleep(interval_s)

    async def _deliver(self, sig: dict) -> None:
        uid = f"{sig.get('symbol')}|{sig.get('sweep_timestamp')}"
        if uid in self._seen:
            return
        self._seen.add(uid)
        if len(self._seen) > 2000:
            self._seen.clear()
        await self.hub.broadcast(sig)
        if self.cfg.use_mt5_python:
            try:
                self.executor.process_signal(sig)
            except Exception:
                log.exception("process_signal failed")

    async def _pump(self, ws) -> None:
        beat = asyncio.create_task(self._heartbeat(ws))
        try:
            while not self._stop.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=3600)
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                sig = parse_broadcast(raw)
                if not sig:
                    continue
                await self._deliver(sig)
        finally:
            beat.cancel()
            try:
                await beat
            except asyncio.CancelledError:
                pass

    async def _heartbeat(self, ws) -> None:
        while True:
            await asyncio.sleep(self.cfg.ws_heartbeat_sec or DEFAULT_HEARTBEAT)
            try:
                await ws.send(phoenix_heartbeat(self._next_ref()))
            except Exception:
                return


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Talaria Signal Copy bridge")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--mode", choices=["shadow", "live"], default=None)
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    cfg = BridgeConfig.load(Path(args.config), mode_override=args.mode)
    log.info("mode=%s endpoint=%s", cfg.mode, cfg.endpoint)

    bridge = Bridge(cfg)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def _sig(*_a):
        bridge.stop()

    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(s, _sig)
        except NotImplementedError:
            signal.signal(s, lambda *_: bridge.stop())

    try:
        loop.run_until_complete(bridge.run())
    except KeyboardInterrupt:
        pass
    finally:
        bridge.executor.shutdown()
        loop.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
