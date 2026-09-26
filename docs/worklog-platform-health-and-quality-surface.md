# Worklog: Platform health & quality surface (admin + users)

> **Date:** 2026-09-26 · **Build Code** authorized · **Repo:** `nobletradingapp`
> **Companion:** `noble-trader-fastapi-backend/worklog/kairos/` (scorecard D–I, G2, rank_score)
> **Request:** After Studio restart / Kairos–geometry work, expose platform improvements to **admin and users** without overclaiming win rates.

## Problem

The portal sells Signal Scout / Precision Pro but shows **subscription state only**. Meanwhile the signal platform has real, measurable improvements (geometry / expiry, resolver completeness, calibration honesty, sweep coverage) that users never see — and admin has no single health strip tied to the research scorecard.

Raw `p_win` and “win rate” are **not** publishable: Kairos G2.2 failed for gate selection; `p_win` does not rank within cell. Product language must stay on **honest quality** (coverage, expiry, edge **vs no-skill**, completeness).

## Goals

| Audience | Surface | Must answer |
|---|---|---|
| **User** | Portal “Platform health” card | Is the service running? Are exits getting saner? What’s improving? |
| **Admin** | Admin “Signal quality” strip | Scorecard-lite: coverage, expiry, edge vs no-skill, evidence completeness, roadmap |

## Non-goals

- No publish of raw `p_win`, “AI win %”, or G2 Δm₂₄ to end users.
- No new pricing / plan claims.
- No writes to `nt_*` from this repo (read-only service role).
- No Edge Function work (supabase/functions deprecated for this path).

## API — `GET /api/platform-health`

Auth: Clerk signed-in (same as other portal APIs). Service-role reads only.

### Response (user-safe subset always)

```json
{
  "generated_at": "…",
  "user": {
    "sweep_coverage_24h": 0.97,
    "last_light_slot_at": "…",
    "expiry_share_7d": 0.28,
    "edge_vs_no_skill_7d": 0.04,
    "eod_resolver_ok": true,
    "improvements": [{ "id": "geometry", "title": "…", "detail": "…" }]
  },
  "admin": {
    "decided_7d": 1200,
    "tp_rate_7d": 0.22,
    "no_skill_7d": 0.31,
    "rank_stamp_share_24h": 0.0,
    "calibration_overconfident_symbols": 6,
    "roadmap": [{ "mechanism": "…", "status": "…", "current_state": "…" }],
    "era_note": "pre/post ATR + resolver-fix splits live in backend worklog"
  }
}
```

- `admin` block present only when `users.role === 'admin'` (or Clerk privateMetadata role).
- Missing views/columns degrade to `null` / `[]` (same `safeData` pattern as `dashboard-data`).
- Computed server-side from `nt_signal_sim` (last 7d light buy/sell), `nt_roadmap`, `nt_calibration_records` counts.

### Definitions (mirror backend scorecard)

| Metric | Definition |
|---|---|
| `sweep_coverage_24h` | distinct 15-min slots with ≥1 light row ÷ 96 (or observed slot span) |
| `expiry_share_7d` | expired / closed on decided+expired light rows |
| `edge_vs_no_skill_7d` | mean(`1{TP} − SL/(TP+SL)`) on decided rows |
| `eod_resolver_ok` | recent `nt_calibration_records` closed_at within 36h |

## UI

### Dashboard — `PlatformHealthCard` tab (`app/dashboard/page.jsx` + `app/components/platform-health-card.jsx`)

- New **Platform Health** tab (between Portfolio and EOD Report).
- Compact status tiles: **Coverage**, **Expiry**, **Edge vs odds**, **Settlement**.
- “What’s improving” list (static-safe copy tied to roadmap themes): geometry / fewer expiries, loss completeness, faster feedback.
- Plain language footer: quality is measured **against the bracket’s own odds**, not a marketing win rate.
- **Not on portal** (2026-09-26 correction): portal stays subscription/onboarding; quality lives with the signal dashboard.

### Admin — `widget_platform_quality.jsx`

- Same tiles + decided/TP/no-skill counts + rank stamp share + roadmap rows (last 8 pending/resolved).
- Wired into `app/admin/page.jsx` after existing customer/payments widgets.

## Files

| Path | Change |
|---|---|
| `docs/worklog-platform-health-and-quality-surface.md` | This worklog |
| `app/api/platform-health/route.js` | New read-only health API |
| `app/components/platform-health-card.jsx` | User-facing card |
| `app/admin/widget_platform_quality.jsx` | Admin quality strip |
| `app/admin/page.jsx` | Mount admin widget |
| `app/portal/page.jsx` | **No mount** — health card is dashboard-only |

## Verify

```bash
npx eslint app/api/platform-health/route.js app/components/platform-health-card.jsx app/admin/widget_platform_quality.jsx
```

Manual: sign in → portal card; admin role → admin strip; sign out → 401.

## Follow-ups (not this change)

- Per-plan symbol coverage using `v_talaria_symbols.plan_ids`
- Era-split charts (post-ATR) once `kairos_rank_score` stamps land on Studio `c02d6be`
- Discord “platform health” weekly digest (Hermes cron)
