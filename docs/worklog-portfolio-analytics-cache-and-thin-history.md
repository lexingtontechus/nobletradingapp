# Worklog — Portfolio analytics cache + correlation thin-history (2026-09-30)

**Repos:** `nobletradingapp` (proxy/cron) · `nobletradingapp-backend` (compute)  
**Gate:** build authorized (“write a worklog for this and build”)

---

## 1. Symptom

| Route | Observed |
|---|---|
| `GET /api/portfolio-analytics/correlation` | **~11.7s** |
| `GET /api/portfolio-analytics/signal-agreement` | **~7.7s** |

Both are Precision Pro portfolio analytics. They proxy `nobletradingapp-backend`
(free Render dyno) and cache the JSON in Supabase for **12h**.

Live cache state at investigation time:

| Cache | `computed_at` | Meaning |
|---|---|---|
| `nt_correlation_cache` | **2026-09-06** | ~24 days stale — every request recompute |
| `nt_signal_agreement_cache` | after the 7.7s hit | miss → compute → write |

## 2. Root causes

1. **Silent cache upserts** (`app/api/portfolio-analytics/*/route.js`)  
   `await supabase.from(view).upsert(...)` ignored `error`. A failed write left
   `computed_at` frozen forever.

2. **Correlation compute actually failing** (the bigger issue)  
   `GET /webapp/correlation-overview` required **every** plan symbol to have a
   daily close on **every** session (`_build_returns_matrix` all-symbol
   intersection). Live probe: **2 complete sessions across 14 symbols** (422).
   Even 4 FX majors → **3** shared sessions.  
   `v_talaria_daily_close` (resampled from `nt_renko_bricks`) simply does not
   have a long, aligned multi-symbol history yet.

3. **No warm job** — first Pro visitor paid Render cold start + compute.

## 3. What we built

### nobletradingapp

| File | Change |
|---|---|
| `utils/portfolio-cache.js` | Shared cache writer: `onConflict=plan_slug`, logs PostgREST errors, compute+upsert helpers |
| `app/api/portfolio-analytics/correlation/route.js` | Use shared writer; surface write errors |
| `app/api/portfolio-analytics/signal-agreement/route.js` | Same |
| `app/api/portfolio-analytics/warm/route.js` | **New** — cron/internal warm (`X-Supabase-Cron` / `X-Internal-Secret`) |
| `supabase/migrations/0026_schedule_portfolio_analytics_warm.sql` | pg_cron every 6h `:25` → `/api/portfolio-analytics/warm` |

Also (same session, user-facing Renko work): migration **184** `LIMIT 8` → **10**
so the price ladder + pattern reader stay on a 10-step window.

### nobletradingapp-backend

`regime_platform/routers/webapp.py` — correlation no longer 422s on thin overlap:

1. **Drop thin symbols** (`_select_history_subset`) until the shared-session
   intersection is large enough (or only two remain).
2. **Pairwise fallback** when shared returns are still below the HMM bar:
   each pair uses **its own** overlapping days (`_pairwise_correlation`).
3. Honest labels in the payload:
   - `corr_regime: "insufficient_history"` when the detector cannot fit
   - `symbols` / `symbols_dropped` / `history_note` / `n_sessions_shared`
   - `kelly_correlation_score` only when the full detector runs

## 4. Verify

**Cache write (live, 2026-09-30):**
- Signal-agreement backend **1.3s**, upsert **OK** (`computed_at` refreshed)
- Correlation backend **422** before backend fix (thin overlap)

**After backend deploy:**
1. `GET /webapp/correlation-overview?symbols=<pro roster>` → 200 with
   `corr_regime` either a real regime or `insufficient_history`, never a bare 422
   unless <2 symbols / <5 shared sessions.
2. `GET /api/portfolio-analytics/warm` (cron header) → `ok: true` for at least
   agreement; correlation may still be matrix-only until history grows.
3. Second member hit on Portfolio tab &lt; 300ms when cache is fresh.

## 5. User-facing impact (plain language)

- **Pairs / agreement** should load quickly after warm.
- **Correlation** shows a matrix when pairs share enough days; if history is
  thin it says so instead of hanging ~11s or erroring.
- Price ladder is **10 steps** again (pattern stability).

## 6. Not done / follow-ups

- Deploy `nobletradingapp-backend` (Render) for the thin-history fix.
- Apply `0026` on Supabase (pg_cron warm).
- Longer-term: materialize daily closes from a denser source than
  `nt_renko_bricks` so full-roster HMM correlation has real history.
- Vercel redeploy for Next.js cache/warm routes.
