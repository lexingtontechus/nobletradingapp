# Worklog — API performance: kill the PostgREST fan-out stampede

**Date:** 2026-09-27  
**Repo:** nobletradingapp  
**Gate:** build authorized (user: cannot deploy until API latency improves)

## Symptom (pre-fix)

| Route | Observed |
|---|---|
| GET /api/me | ~984ms (app 938ms — Clerk `getUser`) |
| GET /api/subscription-status | ~1795ms |
| POST /api/talaria-claim | ~1000ms, **intermittent 500** |
| GET /api/dashboard-data | **7.5s** |
| GET /api/platform-health | **4.2s** |

## Root cause

1. **13-way PostgREST fan-out.** `dashboard-data` issued 13 concurrent `supabase.from(view).select(*)` calls. Measured under load: **parallel wall 6–10s**, intermittent 500s on individual views (connection stampede). Views themselves were fine (300–900ms warm single).
2. **In-process cache did not coalesce.** Concurrent misses all ran the loader.
3. **`/api/me` always called Clerk** (~1s) even when `users.role` was already known.
4. **Claim mint race.** Concurrent `POST /api/talaria-claim` hit the partial unique index `talaria_claims_one_active_per_user_idx` (revoke + insert were two separate transactions).
5. **Payload bloat.** `v_paper_vs_optimized_symbol` groups by `(symbol, realized_pnl)` → 507 rows for ~14 symbols; renko dumped 400 bricks; paper positions 200 rows.

## Fix

### DB (migrations 0023–0025, applied live)

- **`talaria_dashboard_cache`** — single-row JSONB snapshot of the entire dashboard bundle + `health` block.
- **`refresh_talaria_dashboard_cache()`** — rebuilds the snapshot; refreshes `v_talaria_latest_signals` matview `CONCURRENTLY` first.
- **pg_cron** `*/2 * * * *` → refresh cache (duplicate latest_signals-only job removed).
- **`mint_talaria_claim()`** — advisory-locked revoke-then-insert in one transaction.
- Slimmed payload: renko 8/symbol, paperPositions 80 (open first), `vsEqualSymbol` DISTINCT ON symbol (14 rows).

### App

| File | Change |
|---|---|
| `utils/api-cache.js` | Concurrent-miss coalescing (`inflight` map) |
| `app/api/dashboard-data/route.js` | Prefer cache row; live fan-out only as cold fallback. Per-user auth ctx cache 60s. |
| `app/api/platform-health/route.js` | Health from `talaria_dashboard_cache.payload.health`, 60s cache |
| `app/api/me/route.js` | sessionClaims → `users.role` → Clerk last |
| `app/api/talaria-claim/route.js` | Atomic `mint_talaria_claim` RPC; safe plan_id/plans access |
| `app/api/subscription-status/route.js` | Per-user cache 30s; Clerk only on first-visit upsert |

## Expected (warm / in-process cache)

| Route | Before | After (warm) | After (cold) |
|---|---|---|---|
| dashboard-data | 7.5s | **&lt;200ms** | ~2–3s (one cache row + auth) |
| platform-health | 4.2s | **&lt;200ms** | ~1s |
| me | 984ms | **~200ms** (local role) | ~1s only if role unknown |
| subscription-status | 1.8s | **~0ms** (30s cache) | ~1s |
| talaria-claim | 500 race | **200** atomic | — |

## Verify after deploy

1. Hit `GET /api/dashboard-data` twice — second should be &lt;300ms.
2. `POST /api/talaria-claim` twice quickly — both 200, one active token.
3. `GET /api/me` — should not log Clerk on users with `role` set.
4. Confirm cron `refresh_talaria_dashboard_cache` is running (`cron.job` / `talaria_dashboard_cache.refreshed_at`).

## Not done / follow-ups

- PostgREST still has ~200–500ms baseline per REST call — further gains need RPC or edge cache.
- `v_paper_vs_optimized_symbol` underlying GROUP BY is noisy (product bug) — cache collapses it; view left alone for other consumers.
- nobletradingapp **not pushed** (separate gate).
