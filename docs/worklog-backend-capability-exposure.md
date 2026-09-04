# Worklog: Exposing Unused FastAPI Backend Capabilities in the Webapp

> **Status:** Scoping
> **Date:** 2026-09-03
> **Author:** Claude (assessment)
> **Repos in scope:** `nobletradingapp` (UI + new proxy routes), `noble-trader-fastapi-backend` (existing routes, unchanged)

## 1. Problem statement

The stated original goal (surfaced 2026-09-03, after the fixed-basket portfolio view was already being scoped): identify capabilities that exist in `noble-trader-fastapi-backend` but are **not reachable from the webapp today**, and expose them there. `docs/worklog-portfolio-by-plan-views.md` §4 already built the inventory (route-by-route), but it self-imposed a constraint — *"the webapp will never call these directly (no API key ships to the browser)"* — and mapped every route to a read-only Supabase view instead, marking anything with no matching view as ❌/⚠️ "not available standalone." That framing is why the portfolio optimizer, correlation heatmap, backtest runner, and Masaniello sizing all got written off. If the actual goal is to surface those capabilities, the "no backend calls" constraint needs to be dropped, not worked around.

## 2. The actual blocker, and the fix

The FastAPI routes require `API_KEY` and, for some, price/returns matrices the **browser** doesn't have — that's true and doesn't change. But `nobletradingapp` already has a working precedent for this exact shape of problem: `app/api/dashboard-data/route.js` runs **server-side**, holds a secret (the Supabase service-role key) that never reaches the browser, and returns only the derived JSON the client needs. The same pattern applies directly to FastAPI: a **new Next.js API route acts as a server-side proxy**, holds `API_KEY` as a server env var, calls the FastAPI backend, and returns the response to the client. Nothing here requires shipping a secret to the browser or changing the backend.

So "not available standalone" in the prior worklog really meant "not available without a proxy route" — which is a small, well-precedented addition, not a dead end.

## 3. Inventory of currently-unreachable capabilities (from prior worklog §4, re-framed)

| Capability | FastAPI route | Needs from client | Proxy feasibility |
|---|---|---|---|
| Portfolio optimizer (weights, regime-adjusted weights, expected return/vol/Sharpe) | `POST /optimise`, `/optimise/full` | Symbol list (already have via `v_talaria_symbols`) | ✅ Straightforward proxy — backend already computes from its own stored returns |
| Masaniello two-stage sizing | `POST /optimise/masaniello` | Same as above + bankroll param | ✅ Straightforward proxy |
| Correlation heatmap | `POST /correlation/detect` | Symbol list | ✅ Straightforward proxy — returns a correlation matrix + regime, ideal for a heatmap component |
| Backtest runner (30+ metrics, equity curve, trade log, regime distribution, stress tests) | `POST /backtest/run`, `/backtest/compare` | Symbol + date range + strategy params (user-configurable) | ✅ Proxy, but needs a form/config UI since these are parameterized runs, not passive reads |
| Saved backtest history | `GET /backtest/history`, `/backtest/{id}` | — | ✅ Proxy (currently only reachable via service-role `backtest_history` table, i.e. not exposed to the browser at all today) |
| Risk analysis (VaR/CVaR, stress tests) | `POST /risk/analyse`, `/risk/analyze` | Symbol/position params | ✅ Proxy — `risk/analyze` (with stress_tests) has zero view coverage today |
| Renko backtest optimizer | `POST /renko/backtest/optimize` | Symbol + param grid | ✅ Proxy |
| Intraday PnL (Alpaca) | `GET /pnl/intraday` | — | ⚠️ Only meaningful if Alpaca is actually connected for this account; confirm before building |

Everything in this table was previously marked ❌/⚠️ purely because of the "no backend calls" self-constraint, not because it's technically unreachable.

## 4. Design sketch

- One generic pattern: `app/api/backend/<capability>/route.js` — server-side, holds `FASTAPI_API_KEY` (new server env var, not exposed to client), forwards a validated request body to the corresponding FastAPI route, returns the JSON.
- Auth: gate behind the same Clerk session + plan-status check already used in `dashboard-data` (likely Pro-only, matching how `portfolioStats`/`vsEqual` are already Pro-gated) — needs a decision on which capabilities are Pro-only vs available to all plans.
- UI: unlike the fixed-basket view (a passive read), several of these (`backtest/run`, `optimise`, `correlation/detect`) are **on-demand, parameterized actions** — "run this now" buttons/forms, not auto-loaded dashboard tiles. That's a different interaction pattern than anything currently in the dashboard (which is all passive display of pre-computed views).
- Correlation heatmap and portfolio optimizer output are natural fits for new chart types not yet in the dashboard (heatmap, weight bar chart) — flag for the `dataviz` skill when building.

## 5. Open questions

1. **Priority** — which capability first? Portfolio optimizer and correlation heatmap look like the most directly "wow" additions from the Google Finance framing (comparable to seeing sector/asset allocation); backtest runner is the most powerful but the heaviest UI lift (needs a run-configuration form + results view).
2. **On-demand vs cached** — should these run live on user click (real-time API call, possible latency/cost), or be pre-computed on a schedule and read back like the existing views (fits the current passive-dashboard pattern better, but loses "run it yourself" interactivity)?
3. **Plan gating** — Pro-only for all of these, or should some (e.g. correlation heatmap) be available to Signal Scout too?
4. **Relationship to the fixed-basket view** — should this become its own new tab, or should the "Portfolio" tab (once replaced with the fixed-basket view, per `docs/worklog-fixed-basket-portfolio-view.md`) grow to include these as additional panes? Recommend keeping them separate (different interaction model: passive time-series vs on-demand actions) but flagging for a decision.

## 6. Non-goals (for this worklog)

- Does not change any FastAPI backend code — purely adds a webapp-side proxy layer.
- Does not include the fixed-basket portfolio view — that's fully scoped separately in `docs/worklog-fixed-basket-portfolio-view.md`.

---

*Scoping only — no implementation started. Needs answers to §5 before any build work begins.*
