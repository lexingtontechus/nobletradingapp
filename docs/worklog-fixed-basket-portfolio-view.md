# Worklog: Fixed-Size Signal Basket — Per-Plan Simulated P/L View

> **Status:** Scoping
> **Date:** 2026-09-03
> **Author:** Claude (assessment)
> **Repos in scope:** `nobletradingapp` (UI), `noble-trader-fastapi-backend` (signal PnL source data)

## 1. Problem statement

Distinct from the existing Kelly-vs-equal-weight `PortfolioView` (see `docs/worklog-portfolio-by-plan-views.md`), build a **per-plan simulated basket** view: if a fixed, uniform-size trade were taken on every signal generated for a plan's symbol universe, what would the cumulative win/loss and $ P/L look like over time — viewed monthly, up to a 6-month window. Presented Google-Finance-portfolio style: a header $ value + % change, an equity curve with a period toggle (1M/3M/6M), and a per-symbol contribution breakdown (analogous to the "Investments" table in the Google Finance screenshot).

**Decided conventions** (from review on 2026-09-03):
- "0.01 lot" is shorthand for a **fixed $ risk-per-trade applied uniformly to every resolved signal** — not literal FX lot/contract-size semantics. No new per-symbol contract-size/pip-value metadata is introduced.
- This is a deliberately scoped, one-off fixed-notional simulation layered on top of existing signal-level PnL primitives. It is kept separate from the calibration/expectancy work, which stays signal-level only, no capital/concurrency modeling (see `calibration_scope_boundary` memory) — this basket view is the intentional, explicitly-scoped exception, not a precedent for expanding that other work.

## 2. Why this is not a duplicate of existing views

- **`PortfolioStatsCard`** (`app/dashboard/page.jsx:1233-1324`): whole-account, Kelly-sized, single-row tear sheet (Sharpe/Sortino/Calmar/max-DD). Not per-plan, not time-series, not fixed-size.
- **`PortfolioView`** (Portfolio tab, `app/dashboard/page.jsx:1339-1451`): per-symbol Kelly-weighted vs equal-weight (1/N) PnL comparison. No time-series/chart, no fixed-lot concept, mixes signal quality with Kelly sizing skill.
- **New concept**: normalizes away Kelly sizing entirely, applies a uniform fixed notional per signal, and presents it as a time series (equity curve + period selector). This isolates the raw signal edge for a plan and is directly comparable across plans/instruments — genuinely different information, not a re-skin of the above.

## 3. Data feasibility (confirmed by code review)

- `nt_signal_sim.pnl_bricks` / `brick_size` already store the raw 1-unit outcome per resolved signal (`tp_hit`/`sl_hit`/`expired`) — computed in `eod_resolver.py:265-288` (`noble-trader-fastapi-backend`). This is the correct base to re-derive from.
- Do **not** reuse `nt_paper_positions.realized_pnl` (already Kelly/$1000-scaled) or `nt_signal_sim.pnl_dollars` as-is (implicitly 1-unit, not basket-scaled) — both would need to be unwound/re-derived rather than multiplied through.
- Fixed-notional PnL per signal = `pnl_bricks * brick_size * FIXED_UNITS`, where `FIXED_UNITS` is a single constant representing "the fixed size used in the simulated basket." This keeps the basket uniform across asset classes without new instrument metadata.
- Plan scoping: join `nt_signal_sim` → symbol → `nt_symbol.plan_ids` (same join pattern already used for `v_talaria_symbols`).
- No live price feed exists anywhere in the schema (confirmed in the prior worklog's §7 price-data audit). Google Finance's live "Day change" is not literally reproducible — the honest proxy is "PnL from signals resolved (or opened) today," and the UI copy should say so explicitly rather than imply a live quote.

## 4. Proposed shape

- **New SQL view**, e.g. `v_talaria_fixed_basket_daily`: daily rows of `(day, symbol, pnl_bricks, brick_size, pnl_fixed = pnl_bricks * brick_size * FIXED_UNITS)`, joined to plan via `nt_symbol.plan_ids`, aggregated:
  - **Basket equity curve**: cumulative `SUM(pnl_fixed)` per day per plan.
  - **Per-symbol contribution table**: symbol, n_signals, win_rate, total `pnl_fixed`, % of basket total — the "Investments" analogue.
- **Baseline for display**: open question — pure $0-start PnL curve, vs a nominal "invested $X, now worth $Y" framing purely for presentation (this is a simulation, not real capital, so the number is illustrative either way).
- **New date-range utility**: real month arithmetic (existing `VsEqualWeightTable` only does naive `day.slice(0,7)` string bucketing with no enforced cutoff) — needed for a correct 1M/3M/6M toggle.
- **New chart component**: equity/area curve. None exists in the dashboard today (it's tables + a TradingView iframe) — pull in the `dataviz` skill before implementing.
- **Placement**: recommend a sub-view/toggle inside the existing "Portfolio" tab (e.g. "Basket" vs "Allocation") rather than a fourth top-level tab, to avoid tab sprawl — not decided.

## 5. Decisions (resolved 2026-09-03)

1. **Signal scope**: `qualified` signals only — matches what would actually have been tradeable, not the full raw signal stream.
2. **Placement**: **replaces** the existing "Portfolio" tab entirely (not a sub-toggle alongside the Kelly-vs-equal-weight view).
3. **Time ranges**: switchable **1M / 3M / 6M / YTD / MAX** (raised from the original 6M ceiling).
4. **Sizing convention (FIXED_UNITS) — revised**: a flat unit/lot count was rejected in favor of **risk-normalized sizing**, per the user's point that SL/TP distance has to be accounted for or the simulation isn't meaningful for both win/loss counting and $ P/L:

   ```
   units_per_signal = FIXED_RISK_DOLLARS / |entry_price - stop_loss|
   pnl_fixed = pnl_bricks * brick_size * units_per_signal
   ```

   This is the standard "risk a fixed $ amount per trade" position-sizing method a disciplined small-lot trader would actually use — every **loss** comes out ≈ `-FIXED_RISK_DOLLARS` regardless of symbol/brick size, and every **win** scales naturally by that signal's reward:risk ratio (TP distance ÷ SL distance). A flat lot/unit count would instead let SL-distance variance alone swing the $ risked per trade, which would make the basket's W/L behavior misleading — this fixes that.

   Recommend `FIXED_RISK_DOLLARS = $10` (i.e. 1% of the existing `$1000` `NOBLE_PAPER_BASE_NOTIONAL` convention already used in `paper_book.py`) so the simulation doesn't invent a new unrelated magic number — reuses a constant that's already meaningful elsewhere in the codebase. Per the `config_centralization_preference` memory, this should be a config value (e.g. added to the existing tuning-registry YAML pattern), not a new `os.getenv()` flag needing a new Studio Secret.

5. **Display baseline**: given risk-normalized sizing produces a coherent $ series, recommend the Google-Finance-style framing: nominal starting balance (suggest reusing **$1,000**, same constant as above) + cumulative `pnl_fixed`, headlined as `$1,000 → $1,247.50 (+24.7%)`. Showing **%** change (not just raw $) also makes the basket comparable across plans/symbol-universes regardless of which nominal baseline is picked.

## 6. Non-goals

- No live intraday pricing / mark-to-market (infra doesn't exist).
- No new per-symbol contract-size/pip-value schema (superseded by the risk-normalized sizing approach in §5.4, which needs only `entry_price`/`stop_loss`, both already stored per signal).
- Correlation heatmap / portfolio optimizer / backtest runner / Masaniello sizing are **out of scope for this specific view** — see `docs/worklog-backend-capability-exposure.md` for that separate, broader initiative.

---

*Scoping resolved for this view. Next step: implement per §4/§5 on explicit go-ahead.*
