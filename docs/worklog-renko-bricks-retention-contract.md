# nt_renko_bricks retention contract (cross-repo) — 2026-10-01

**Status:** informational — documents an existing dependency, no code change.
**Related:** `noble-trader-fastapi-backend/worklog/20261001_NT_RENKO_BRICKS_TIMEOUT_AND_GROWTH.md` §13 ("Track A").

## What this is

`noble-trader-fastapi-backend` is scoping a fix (Track A) for
`nt_renko_bricks` growing unbounded (800k+ rows, 50%+ of the whole
database, Postgres statement timeouts on `v_talaria_daily_close`). Part of
that fix is letting the table's existing nightly retention
(`renko_brick_retention_days`, default 2 — "today + yesterday") finally
bind, which today it effectively does not (two separate bugs: a
roster-discovery cap, and a missing `session_date`-leading index making
the age-based DELETE itself likely time out).

**This repo (`nobletradingapp`) depends on that same table staying at
least 2 live sessions deep, for a completely different reason than
correlation does.**

## The dependency

`v_talaria_renko` (`supabase/migrations/0009_talaria_dashboard_views.sql`)
is a plain `SELECT` over `nt_renko_bricks`, ordered
`session_date DESC, brick_index DESC`. Two consumers fetch "last 10 bricks
per symbol" (sometimes up to 200) from it:

- `app/dashboard/page.jsx` → `RenkoSection` (the dashboard Renko chart +
  Markov card)
- `noble-trader-talaria`'s desktop/plugin dashboard (`plugin.js`,
  `useSupabaseData(config, 'v_talaria_renko', {order:
  'session_date.desc,brick_index.desc', limit: '10'/'200', ...})`)

Both need the CURRENT live brick grid (today's session, correct
`brick_size` per `config/brick_params.yaml`) to actually have rows. If
`nt_renko_bricks` retention is ever tightened below "today + yesterday,"
or changed to prune by some rule that doesn't also account for which grid
is live, these charts go empty or stale — independent of, and unrelated
to, the 120-day correlation window that `nt_daily_close` /
`v_talaria_daily_close` separately needs (a different consumer,
`nobletradingapp-backend`'s `fetch_daily_closes`).

**This is not a new requirement.** `renko_brick_retention_days: 2` was
already sized for exactly this — see
`renko_retention.py`'s own module docstring: *"...so the chart's 10-brick
window is always the latest session."* This note (and the matching
comment added directly to migration 0009's `v_talaria_renko` view) exists
so Track A's eventual build doesn't shorten or restructure that retention
window without someone checking it against this chart dependency first —
the two needs (correlation's 120 days, the chart's 2 days) are easy to
conflate since both read the same underlying table, but they are
genuinely different consumers with different windows.

## Action items for whoever builds Track A

- Keep `renko_brick_retention_days` at 2 unless this note (and the chart
  behavior) is explicitly re-verified.
- The chart's requirement is NOT "the table's total row count" — it's "the
  live `(symbol, current_brick_size, today-or-yesterday session_date)`
  grid has rows." Track A's one-time backlog cleanup and ongoing nightly
  retention both need to preserve that live grid, which is exactly what
  the existing `renko_retention.py` design (stale-`brick_size` pass +
  age-cutoff pass) is supposed to do once its two bugs are fixed — this
  dependency doesn't require any NEW logic, just confirms the existing
  design target is correct and must not regress.
- If the live grid is ever empty for a symbol during/after a Track A
  change, the dashboard already has a defensive fallback
  (`generateBricks`, landed 2026-09-28 per
  `docs/worklog-renko-chart-grid-mismatch-and-orphan-purge.md`) — it won't
  crash, but the chart silently stops showing real data, which is still a
  regression worth catching before it ships.
