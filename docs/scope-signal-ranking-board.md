# Scope — Signal ranking board (Realtime + Discord)

**Status:** scoped, not built · **Date:** 2026-09-28  
**Full spec:** `noble-trader-fastapi-backend/worklog/kairos/scopes/20260928_RANK_BOARD_BROADCAST_DISCORD.md`

## Goal

Users prioritize **capital** with **RANK**, not raw `p_win`:

```text
SIGNAL              P_WIN   RANK   EV      STATE
XAUUSD                0.64   0.91  +0.43R  FRESH
EURUSD CRT            0.67   0.76  +0.36R  WARM
```

- **RANK** (`kairos_rank_score`) — opportunity (freshness + setup type + recent TP + cell)
- **P_WIN** — probability · **EV** — risk/reward · **STATE** — FRESH/WARM/STALE/DEEP

## nobletradingapp

1. **Ranking board** (dashboard): columns SIGNAL · P_WIN · **RANK** · EV · **STATE**; default sort RANK desc.
2. **Realtime:** subscribe `realtime:signals`; payload gains `rank`, `state`, `transition` (fail-open if null).
3. **Copy:** Rank ≠ win%. Size with Kelly; prioritize by Rank.

## Discord (backend `discord_delivery.py`)

1. Embed fields: **RANK**, **STATE** next to P_WIN/EV.
2. Published only (`gate_outcome=qualified`).
3. Optional later: Top-N by RANK digest.

## Non-goals

Auto-size from rank · live rank gate · replacing Kelly/EV · setup-name taxonomy (CRT/LVN) in v1.
