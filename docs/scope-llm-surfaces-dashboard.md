# Scope — LLM surfaces in the dashboard (macro panel + admin self-learning)

**Status:** scoped, not built · **Date:** 2026-10-04
**Backend scopes:**
- `noble-trader-fastapi-backend/docs/scopes/20261004_LLM_VALUE_AUDIT_AND_UTILIZATION_SCOPE.md`
- `noble-trader-fastapi-backend/docs/scopes/20261004_MACRO_FORECAST_CONSUMER_SCOPE.md`
- `noble-trader-fastapi-backend/docs/scopes/20261004_SELF_LEARNING_TRIAGE_SURFACE_SCOPE.md`

## 0. Why

Four LLM surfaces in the backend currently produce output that **nothing reads**
(measured 2026-10-04). Two of them should reach a human through this app:

| Backend table | Rows | Audience | Surface |
|---|---|---|---|
| `nt_macro_forecast` | 33 symbols, daily | members (Analysis tab) | **Macro panel** (§2) |
| `nt_self_learning_findings` + `_reports` | 54 findings / 54 reports | admin only | **Self-learning panel** (§3) |

The other two (Clef-Flash, BGE-small) get **no UI** — Clef-Flash is repurposed to a
backend text classifier, BGE-small is an internal embedding swap. Neither has a
user-facing product.

## 1. Data access (server-side only)

Both surfaces read through **new server-side API routes** holding the service-role key,
following the exact `app/api/dashboard-data/route.js` pattern. **No new anon grants for
the self-learning tables** — findings name internal mechanisms and propose parameter
changes; they must not be readable with the public anon key.

Two new backend views (one migration, `noble-trader-fastapi-backend/supabase/migrations/`):

```sql
-- v_talaria_macro_forecast — member-facing, anon-granted (display only)
CREATE OR REPLACE VIEW v_talaria_macro_forecast AS
SELECT
  symbol, asset_class, source_doc,
  current_macro_label, current_macro_strength,
  current_trend_label,
  structure_bias, structure_strength, structure_note, structure_as_of,
  pivot_label, pivot_axis, pivot_intensity, pivot_event_title, pivot_summary, pivot_as_of,
  thesis, drivers, risks, events,
  model_provider, updated_at
FROM nt_macro_forecast
ORDER BY asset_class, symbol;
GRANT SELECT ON v_talaria_macro_forecast TO anon;

-- v_self_learning_triage — ADMIN ONLY, no anon grant (see §3)
CREATE OR REPLACE VIEW v_self_learning_triage AS
SELECT
  r.id AS report_id, f.id AS finding_id, f.detector, f.symbol,
  f.summary AS finding_summary, f.detected_at, f.triaged_at,
  r.narrative, r.proposed_param, r.proposed_value, r.current_value, r.created_at,
  COALESCE(f.reviewed, false) AS finding_reviewed,
  COALESCE(r.reviewed, false) AS report_reviewed
FROM nt_self_learning_reports r
JOIN nt_self_learning_findings f ON f.id = r.finding_id
ORDER BY f.detected_at DESC;
```

> Note: `nt_macro_forecast` already carries a public `COMMENT` on the columns; the
> view re-exposes only display fields. `nt_macro_forecast` base table has no anon grant
> today, so the view is the sole read path.

## 2. Macro panel (Analysis tab, all plans)

A new card on the **Analysis** tab, beside the existing Kelly/Renko sections. Per-symbol
`thesis` + strategic read + short-term structure + the latest typed pivot.

```
┌─ Macro outlook — XAUUSD ────────────────────────────────┐
│ Strategic   🐂 BULL  strength 0.80   (12m, LLM)         │
│ Trend       📈 Trending up           (12m, LLM)         │
│ Structure   🐻 Bear 0.44  rsi=38 macd-  (short-term TA) │
│ Pivot       no_change · none · as of 2026-10-03         │
│                                                         │
│ Thesis: XAUUSD will close above 2,800 by end of Q4 2026 │
│ Drivers: real-rate cuts 🐂0.8 · CB buying 🐂0.7          │
│ Risks:   real-yield spike 🐻0.4 · crisis bid 🐂0.2       │
│                                  as of 2026-10-04 02:45 │
└─────────────────────────────────────────────────────────┘
```

**Rules (mirror the existing dashboard conventions):**
- **Fail-open on null** — every field renders `—` when missing; `structure_bias` is only
  populated for 14/33 symbols today, so it must not block the card.
- **Label the source** — "12m, LLM" vs "short-term TA" vs "price" so a member never reads
  an LLM narrative as a live trading call.
- **Not a signal** — the card carries the same "not trading advice" framing as the EOD tab;
  it is strategic context, not a BUY/SELL.
- **Symbol selector** — reuse the existing dashboard symbol picker (plan-scoped roster).
- **Drivers/risks as daisyUI badges** — `badge-success`/`badge-error`/`badge-ghost` by
  stance; `confidence`/`severity` shown as a small monospace value. No new chart type.

## 3. Self-learning panel (admin only)

Admin-only card. Reads through a new `/api/admin/self-learning` route (service-role,
`isAdmin` gate resolved server-side exactly like `/api/platform-health`).

```
┌─ Self-learning findings (admin) ────────────────────────┐
│ ⚠ dead_mechanism           2026-10-04   [dismiss]       │
│   regime_label_debounce_mode: live, shadow stale        │
│   LLM: "…the shadow table stops writing when the mode   │
│   is live — expected, not a fault…"                     │
│   Proposal: STAGNATION_EPSILON 0.05 (current: —)        │
├─────────────────────────────────────────────────────────┤
│ ⚠ regime_price_mismatch · AAPL   2026-09-29  [dismiss]  │
│   regime read up 3d (conf 0.91) while price −3.22%      │
│   LLM: "…detector compares the peak to the final day…"  │
│   Proposal: none                                        │
└─────────────────────────────────────────────────────────┘
```

**Rules:**
- **Dedup** — group by `finding_summary`; show the latest of each. The backend detector
  fix (see `20261004_SELF_LEARNING_TRIAGE_SURFACE_SCOPE.md` §2.1) stops the re-fire at
  source, but the UI must also collapse the 15 historical duplicates so the list is usable
  on day one.
- **`current_value: —` is meaningful** — every proposal today has a NULL baseline, so
  render `—` and a tooltip ("no baseline — proposal not actionable") rather than hiding it.
- **Dismiss** — a `[dismiss]` button PATCHes `reviewed = true` on the report (and its
  finding) via a new route; dismissed rows drop out of the open list.
- **No auto-apply** — there is deliberately no "apply" button. `triage.py` never imports
  `tuning_registry.write_param`; a human actions any parameter change through the existing
  tuning path.

## 4. Components to add

| File | Purpose |
|---|---|
| `app/components/macro-outlook-panel.jsx` | §2 macro card (client, reads `/api/dashboard-data` extension or a dedicated route) |
| `app/api/macro-forecast/route.js` | server route → `v_talaria_macro_forecast` (plan-scoped) |
| `app/admin/widget_self_learning.jsx` | §3 admin panel (client, reads `/api/admin/self-learning`) |
| `app/api/admin/self-learning/route.js` | server route → `v_self_learning_triage` + PATCH reviewed |

The macro panel can also fold into `dashboard-data` (one more view in the cached bundle)
rather than a new route — decide at build time based on the bundle's existing 13-view fan-out.

## 5. Open questions

1. **Macro panel placement** — new card on the Analysis tab, or fold into the existing
   Renko/Markov column? Recommend the Analysis tab (it is strategic, not per-symbol-TA).
2. **Plan gating** — macro panel for all plans (recommended; it is context, not a signal)
   or Precision Pro only?
3. **Narrative length** — `thesis` is one sentence, `narrative` (from the classifier) is
   1–2 sentences. Truncate with an expand, or show in full? Recommend full for `thesis`,
   truncated for the triage narrative.
4. **Admin route naming** — `/api/admin/self-learning` vs folding into `/api/platform-health`'s
   admin block. Recommend a separate route (it has a PATCH action; `platform-health` is GET-only).

## 6. Non-goals

- No Clef-Flash UI (backend-only classifier).
- No BGE-small UI (internal embedding swap).
- No new anon grants on `nt_self_learning_*`.
- No auto-application of LLM-proposed parameter changes.
- No direction/trend classification from price by an LLM in any surface.
