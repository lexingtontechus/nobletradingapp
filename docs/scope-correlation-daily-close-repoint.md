# Scope — Correlation matrix: repoint daily-close source + maturity gate

> **Status:** BUILT (2026-10-04) — WS1 applied to production (migration 0027); WS2 in `app/dashboard/page.jsx`.
> **Repos:** `nobletradingapp` (view + UI). `nobletradingapp-backend` (no change needed — see §4).
> **Evidence:** live Supabase probes, `NobleTrading` (`pcvscowltlrxzgxjurcr`), 2026-10-04.
> **Post-build verification:** `v_talaria_daily_close` now reads `nt_daily_close` →
> 7 sessions / 96 rows (was 3). Roster 14 symbols, 5 complete days → below the
> 20-session gate, so the UI shows the honest "building history" state.

---

## 1. TL;DR

The Portfolio tab's **correlation matrix** reads a daily-close series that is
effectively empty (3 sessions), while a purpose-built, correctly-populated
table (`nt_daily_close`, 7 sessions and growing) sits unused. Two independent
layers:

1. **Wiring** — `v_talaria_daily_close` resamples `nt_renko_bricks` and collapses
   history. Repoint it to `nt_daily_close`. **One migration, zero caller change.**
2. **Maturity** — even repointed, ~7 sessions exist vs the ~21 the regime
   detector needs. Correlation cannot be *reliable* yet. Gate the UI on a real
   history threshold and demote it below the lenses that DO work today.

**Not a symbols problem, not a raw-data problem** — see §3.

---

## 2. Evidence (live)

| Source | Rows | Distinct sessions | Span |
|---|---|---|---|
| `nt_renko_bricks` (raw) | 86,106 | **3** distinct `session_date` (10-02/03/04) | ts 2026-08-24 → 10-04 |
| `v_talaria_daily_close` (view, from renko) | ~42 | **3** | 2026-10-02 → 10-04 |
| `nt_daily_close` (purpose-built table) | 96 | **7** | 2026-09-28 → 10-04 |
| `nt_signal_sim` (qualified, for agreement) | 3,361 | 43 | 2026-08-23 → 10-04 |

`v_talaria_daily_close`'s 3 sessions come from `session_date` being stamped
`2026-10-04` on **76,884 / 86,106** bricks (89%) regardless of their `ts`
(which span 30+ days). The view's `DISTINCT ON (symbol, session_date)`
therefore collapses ~30 real trading days into 3.

Cached correlation payload (precision_pro): `symbols_used = ["USDCHF","XAUUSD"]`,
`n_bars: 1`, `corr_regime: insufficient_history`, **12 of 14 symbols dropped**.

`nt_daily_close` (migration 190) has **correct** `session_date` values
(1 row per symbol-session) and is kept current nightly by
`daily_close_snapshot.py` (last top-up 2026-10-04 01:30 UTC).

---

## 3. What the platform is actually missing

| Candidate | Verdict |
|---|---|
| More symbols | ❌ 14 already spans FX / metals / indices / crypto / equities. More symbols = a bigger thin matrix. |
| More raw data | ❌ 86k bricks, 46k sweeps, 3.4k qualified signals over 31 days. |
| **Clean daily-close history** | ✅ ~7 sessions now; ~21 needed for the regime HMM. |

---

## 4. Proposed change — WS1: repoint the view (data correctness)

`v_talaria_daily_close` is owned by **nobletradingapp** (`supabase/migrations/0011_correlation_cache.sql:20-34`).
`nt_daily_close` exposes exactly the columns the view already returns
(`symbol, session_date, close_price, ts`) and is anon-readable (migration 190).

**Proposal:** a new nobletradingapp migration that redefines the view:

```sql
CREATE OR REPLACE VIEW public.v_talaria_daily_close AS
SELECT symbol, session_date, close_price, ts
FROM public.nt_daily_close;
```

**Why this shape (vs. changing the backend):**

- **Zero caller change.** `nobletradingapp-backend`'s `fetch_daily_closes`
  (`services/supabase_client.py:70-135`) reads the view *by name* — it keeps
  working, now against correct data. The EOD report function
  (`supabase/functions/eod-report-generate/index.ts:235`, "current price") is
  fixed at the same time.
- **Same column contract**, same grants.
- **Removes a cross-repo hazard:** today correlation depends on
  `nt_renko_bricks` staying deep. Track A's retention (backend) will prune that
  table — see `docs/worklog-renko-bricks-retention-contract.md`. Repointing
  decouples correlation from brick retention entirely.

**This is a pre-planned item, not a new idea.** `noble-trader-fastapi-backend`
worklog `20261001_NT_RENKO_BRICKS_TIMEOUT_AND_GROWTH.md` §13 built
`nt_daily_close` *specifically* to be this view's source and explicitly
deferred the repoint to "its own scope doc + approval in `nobletradingapp`"
(§13 table row 2). This is that doc.

**Sequencing:** repoint **before** Track A tightens `nt_renko_bricks`
retention, otherwise correlation regresses. Low risk either way (the view is
currently near-empty), but the order matters.

---

## 5. Proposed change — WS2: maturity gate + demotion (UX)

Even repointed, ~7 sessions ≪ ~21 needed. Correlation will remain
`insufficient_history` for roughly another 2–3 weeks. The current UI renders a
near-empty grid that "reads as lacking" (user-reported). Proposal:

- **Gate the matrix on a history threshold** (e.g. `n_sessions_shared >= 15`):
  below it, show a single honest state — *"Correlation needs ~N trading
  sessions of shared history; currently M. Available in ~X days."* — instead of
  a grid of dashes.
- **Demote correlation below the working lenses.** Order becomes:
  1. Regime alignment (works today — `nt_regime_log`)
  2. Concurrent-signal agreement (works today — 43 days of qualified signals)
  3. Correlation matrix (gated until mature)
- **Keep** the honesty fixes already built (`docs/worklog-portfolio-matrix-honesty.md`):
  coverage note, `—` for null cells, `insufficient_history` banner. The gate
  supersedes the banner's *empty* case but the coverage note stays useful once
  the matrix has data.

**Threshold choice is a decision — see §7.**

---

## 6. What is NOT changing

- **No symbol changes.** 14 is fine.
- **No backend change** (WS1 is view-only).
- **No agreement-matrix change** — it's healthy (43 days). Only correlation is starved.
- **No `MIN_PAIR_DAYS` / `MIN_OVERLAP_DAYS` tuning** — retracted; thin data isn't a threshold problem (verified in `docs/worklog-portfolio-matrix-honesty.md` §2).
- **No new table / no seed rows.** WS1 is a view redefinition over an existing table.

---

## 7. Decisions needed (for review)

1. **View repoint (WS1):** approve `CREATE OR REPLACE VIEW v_talaria_daily_close → nt_daily_close`?
   - Alt: new view name + migrate callers (more churn, no benefit I can see).
2. **Maturity gate threshold (WS2):** what `n_sessions_shared` gates the matrix?
   - Options: **15** (conservative, ~2 weeks out), **20** (matches the HMM's
     `MIN_WINDOW+10`), or **show the matrix but labelled "low confidence"**
     (no hard gate). Recommend **20** — it's the same bar the detector itself uses,
     so "shown" and "trustworthy" become the same condition.
3. **Demotion:** OK to reorder the Portfolio tab (regime → agreement → correlation)?
4. **`session_date` root cause:** should I also flag the mis-stamping in
   `nt_renko_bricks` to the backend team (separate concern — it affects
   `v_talaria_renko` ordering too), or leave it? Recommend: flag, don't fix here.
   → **DONE.** Backend migration `noble-trader-fastapi-backend/supabase/migrations/196_nt_renko_bricks_session_date_fix.sql`
   documents the root cause (writer stamps the sweep RUN date, not the brick's
   `ts::date`) and applies the safe part (UTC default). The destructive history
   rewrite is **held**: a naive `SET session_date = ts::date` collides on the
   unique key `(symbol, brick_index, session_date, brick_size)` for 9,313 groups
   (22,136 rows), 7,621 of which contain genuinely different bricks — resolving
   by keeping one row would delete real data. Needs a reviewed policy; recipe
   documented in the migration. The writer fix (`log_renko_bricks`) is also
   flagged there.

---

## 8. Verification plan (when built)

- `SELECT count(distinct session_date) FROM v_talaria_daily_close` → expect **7**,
  rising ~1/day (vs 3 today).
- Re-run the correlation warm; cached payload `symbols_used` should cover more
  of the roster and `n_bars` should rise (still `insufficient_history` until ~21).
- `GET /api/portfolio-analytics/correlation` → matrix populates as sessions accrue.
- UI: below-threshold state renders the honest "available in ~X days" message;
  above-threshold renders the matrix with the coverage note.
- `npm run lint` + `npm run build` clean.

---

## 9. Open questions

- Does the EOD report's "current price" want `nt_daily_close`'s latest session,
  or the live intraday price? (Today it reads the view's latest close — repoint
  keeps that behavior, arguably correct.)
- Should the gate count **shared** sessions (all symbols) or **per-pair**
  overlap? Shared is simpler and matches the HMM input; per-pair is more
  informative but reintroduces the thin-pair noise the honesty work removed.
  Recommend **shared**.

---

*Scoping only — no implementation started. Awaiting approval on §7 decisions.*
