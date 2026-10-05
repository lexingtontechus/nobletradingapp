# Worklog — Portfolio tab: correlation/agreement matrix honesty

> **Status:** scoped + UI built (2026-10-04)
> **Repos:** `nobletradingapp` (UI). Backend (`nobletradingapp-backend`) flagged only.
> **Trigger:** user triage of the Portfolio tab matrices + "why is there an other row"-class
> reporting-honesty gaps. Evidence below is from live Supabase probes on the
> `NobleTrading` project (`pcvscowltlrxzgxjurcr`).

---

## 1. Answered: is the Portfolio tab, or only the matrices, plan-bound?

**Only the matrices' *data* is plan-bound. The tab is role/plan-*gated*, not plan-*scoped*.**

| Layer | Binding | Where |
|---|---|---|
| Tab render | `isPro ? <SignalRiskCard/> : <PlanGateCard/>` — a **gate**, not a scope | `app/dashboard/page.jsx:3068-3075` |
| `isPro` | `isAdmin \|\| planSlug === "precision_pro"` | `app/api/dashboard-data/route.js:228` |
| Matrix data | `planSymbolRoster(planUuid)` → `v_talaria_symbols WHERE plan_ids @> [planUuid]` | `utils/portfolio-cache.js:222-229` |
| Cache rows | keyed by `plan_slug` (`onConflict: plan_slug`) | `utils/portfolio-cache.js:48` |

**Live roster check — both plans resolve to the SAME 14 symbols:**

```
signal_scout    → AAPL,AUDUSD,BTCUSD,EURUSD,GBPUSD,US30USD,US500,USDCAD,USDCHF,USDJPY,XAGUSD,XAUAUD,XAUEUR,XAUUSD
precision_pro   → (identical)
```

So the plan-scoping is *implemented* (roster is fetched per `planUuid`, cache is per
`plan_slug`) but currently produces **no differentiation** — and Signal Scout never
reaches the matrices at all (it sees the upgrade `PlanGateCard`). Net: the matrices are
effectively Precision-Pro-only today, and the per-plan binding is inert until the rosters
diverge. **No code change recommended** — this is a "know it's currently moot" note, not a
defect.

---

## 2. Verified: raising the pairwise overlap floor yields nothing

Earlier assessment floated "raise `MIN_PAIR_DAYS` from 3 to >10". **Verified false.**
`v_talaria_daily_close` (resampled from `nt_renko_bricks`) currently holds **3 sessions
total** (2026-10-02 → 2026-10-04):

| symbol | sessions |
|---|---|
| USDCHF | 3 |
| AAPL, AUDUSD, EURUSD, GBPUSD, US30USD, US500, USDCAD, USDJPY, XAGUSD, XAUAUD, XAUEUR, XAUUSD | 2 |
| BTCUSD | 1 |

Max possible pairwise overlap is 2–3 sessions (≈1–2 returns). **Any floor >3 (and
arguably ≥3) yields an empty matrix.** The floor is not the lever — the *data* is thin.
**Recommendation retracted.** The right move is to report the thinness honestly, not to
tune the threshold.

Root cause of the thinness: `v_talaria_daily_close` is a resample of `nt_renko_bricks`,
which only has ~3 daily sessions accumulated (the view was rebuilt recently). The
*qualified-signal* source for the agreement matrix is far denser — `nt_signal_sim` has
**3361 qualified rows across 14 symbols and 43 days** (2026-08-23 → 10-04) — which is why
the agreement matrix is full and the correlation matrix is nearly empty.

---

## 3. Confirmed live defects (UI)

**D1 — Symbol subset is undisclosed.** Correlation payload for precision_pro:
`symbols_used = ["USDCHF","XAUUSD"]`, `symbols_dropped = [12 symbols]`. The UI renders a
2×2 matrix with no indication that 12 of 14 plan symbols were dropped for thin history.
A user reads it as their roster. `history_note` is in the payload but **never rendered**
(`grep history_note` → only assigned in `friendlyAnalyticsPayload`, `page.jsx:1983`).

**D2 — Missing correlation cells render as `0.00`.** `page.jsx:2272,2276` use
`Number(v ?? 0).toFixed(2)`. A `null` cell (no shared history) displays as **0.00** on the
neutral grey scale — i.e. "uncorrelated" — when it means "unknown". With the current
2-symbol matrix, *every* off-diagonal cell is null, so the whole matrix reads as 0.00.

**D3 — `insufficient_history` isn't visually distinguished.** The regime StatCard shows
"insufficient history", but the matrix + "Most concentrated"/"Best hedges" callouts render
as if the data were real. The callouts silently empty (thresholds `>0.3` / `<-0.1` on a
null matrix).

---

## 4. Recommendations (revised by evidence)

| # | Rec | Repo | Effort | Status |
|---|---|---|---|---|
| R1 | Render `symbols_dropped` — "Showing N of M symbols …" + dropped list | nobletradingapp | S | **built** |
| R2 | Render `null` correlation cells as `—` (muted), never `0.00` | nobletradingapp | S | **built** |
| R3 | When `corr_regime === "insufficient_history"`, show a prominent notice; suppress the pair callouts | nobletradingapp | S | **built** |
| R4 | Retract "raise overlap floor" — no threshold change | — | — | retracted |
| R5 | Per-cell overlap counts on the correlation matrix | backend | M | **deferred** — backend discards `_overlap`; and with ≤3 sessions it'd read "3" everywhere. Revisit when history grows |
| R6 | Document plan-binding inertness (§1) | nobletradingapp | XS | **this doc** |

**Not recommended:** any change to `MIN_PAIR_DAYS` / `MIN_OVERLAP_DAYS` (R4). The
agreement matrix is healthy (43 days of qualified-signal history) and needs nothing.

---

## 5. Build (this session)

`app/dashboard/page.jsx`, `SignalRiskCard`:

- **Coverage note** after the stat cards: when `symbols_dropped` is non-empty, an
  `alert-warning` reads *"Showing N of M symbols — the rest lack enough shared trading
  days to correlate yet: …"*, with the dropped list in mono.
- **Correlation matrix**: `null` cells render `—` on a muted background with a
  "no shared history" tooltip; the callouts render only when at least one non-null pair
  exists; an `insufficient_history` banner explains the empty state.
- No backend change, no schema change, no new dependency.

**Verified:** `npm run lint` (0 errors), `npm run build` (compiled), plus the live data
above. Not committed — separate gate.
