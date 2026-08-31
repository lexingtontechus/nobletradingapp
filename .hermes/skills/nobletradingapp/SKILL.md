---
name: nobletradingapp
description: >
  Subscription commerce web app — Next.js 16 + Clerk + Helio checkout + Supabase.
  Provisions per-subscriber Redis ACL users. Owns license-validate Edge Function.
category: trading
version: "2026.08.23"
triggers:
  - "Clerk auth"
  - "Helio checkout"
  - "subscription commerce"
  - "Supabase RLS"
  - "plan entitlement"
  - "Next.js 16"
  - "landing/pricing pages"
related_skills:
  - noble-trader-stack
  - noble-trader-operating-workflow
---

# Nobletradingapp (nobletradingapp)

Subscription commerce platform: marketing site + subscriber portal + admin
dashboard. Next.js 16 App Router, NO `src/` dir. Clerk auth (role =
`privateMetadata`). `@clerk/nextjs ^7.7.1`, `@heliofi/checkout-react ^4.0.9`.
Provisions per-subscriber Redis ACL users on `signals:signal_scout` /
`signals:precision_pro`. Owns `license-validate` Edge Function.

## Repo identity

- Next.js 16.0.7 App Router + React 19 + Tailwind CSS 4 + shadcn/ui + lucide-react
- Clerk (`@clerk/nextjs ^7.7.1`, `@clerk/backend ^3.16.1`) — hybrid publicMetadata
  pattern
- Helio/MoonPay Commerce (`@heliofi/checkout-react ^4.0.9`) — crypto USDC checkout
- Supabase Postgres + RLS (keyed on Clerk JWT `sub`)
- Supabase Edge Functions (Deno): `helio-webhook`, `redis-credentials-manager`,
  `talaria-check`, `send-renewal-reminders`, `sweep-expired-redis-creds`,
  `license-validate`, `symbols-for-plan`
- AgentMail.to (renewal reminders)
- Recharts 3 (admin revenue chart)
- Lint: `eslint .` (flat config, NOT `next lint` — removed in Next 16)

## Operating context

- **No `src/` dir**: app lives at `app/`. `app/page.js` (landing), `app/pricing/
  page.jsx` (plan cards + Helio checkout), `app/portal/page.jsx` (subscriber
  portal), `app/admin/` (revenue dashboard, admin role only).
- **Clerk role = `privateMetadata` ONLY**: `publicMetadata` stays NULL for ALL
  users. Admin role lives only in Clerk `privateMetadata.role = "admin"`
  (server-readable, invisible to browser SDK). DO NOT promote role to public
  metadata — client components CANNOT see private metadata by design.
  `/api/me` is the canonical bridge: server reads public+private metadata,
  returns `{ userId, role: "admin"|"member"|null }` to browser components.
- **`users` table = lazy mirror on 3 upsert paths only**: `create-subscription`,
  `subscription-status` first-visit, `talaria-claim`. NO Clerk webhook.
  Table-only source → `role=null` for users who never hit an upsert path.
  Admin UI hidden via `header.jsx` (reads `/api/me`, not `users.role`).
- **Subscription commerce**: Signal Scout $199/mo (10 symbols), Precision Pro
  $599/mo (20 symbols, "Most popular"). Crypto USDC via MoonPay Commerce (Helio)
  checkout. Discord identity captured by Helio at checkout (NOT by app-built
  OAuth flow — user explicitly rejected that architecture).
- **Hybrid auth pattern**: every writer mirrors subscription state into Clerk
  `publicMetadata`; portal reads from JWT for instant first paint, then refreshes
  from `/api/subscription-status`. Supabase remains source of truth; Clerk
  `publicMetadata` is a cache.
- **Plan entitlement**: provisions per-subscriber Redis ACL users on
  `signals:signal_scout` / `signals:precision_pro`. `license-validate` Edge
  Function lives here (NOT backend). Plan gating is dynamic from `nt_symbol`
  (no hardcoded symbols).
- **Onboarding wizard**: desktop plugin (`desktop/plugin.js`) collects credentials
  → POSTs to backend `POST /setup` → writes `.env` + auto-generates
  `config/user.local.yaml` + runs DuckDB cold-start. Required: `NOBLE_TRADER_PROXY_REDIS_URL`,
  `NOBLE_TRADER_QUOTE_PROXY_URL`, `TRADINGVIEW_API_KEY`, `METAAPI_TOKEN_DEMO`/
  `METAAPI_ACCOUNT_ID_DEMO`, `METAAPI_TOKEN`/ `METAAPI_ACCOUNT_ID`.
- **Marketing copy = canonical**: `docs/marketing/*.md` is source of truth for
  every claim, price, and feature on the landing page. `app/page.js` uses
  `PLAN_COPY` keyed by title. Prices: Signal Scout $199/mo, Precision Pro $599/mo.
- **Supabase anon RLS**: migrations 107 + 110. Anon key must be READ-ONLY live
  (probe before believing — anon was NOT read-only at one point, mutations
  succeeded). Probe sequence: SELECT with anon key → 200; WRITE probes →
  must be 401/403, NEVER 204 (204 = mutation succeeded).
- **Edge Functions are DEPRECATED**: do NOT modify `supabase/functions/`. Active
  Python code paths (`regime_platform/`, `notifications/`) are authoritative.
  Issues in edge functions: document only.
- **Lint migration (Next 16)**: `next lint` removed. `npm i -D eslint@^9
  eslint-config-next@^16`. `package.json`: `"lint": "eslint ."`. `eslint.config.mjs`
  (flat config, `core-web-vitals` only — JS-only repo, no TS preset). Legacy
  baseline: 83 findings on first run, do NOT "fix all" — configure honestly.
  First-run findings were ALL in `_*`/ `_archive/` dead code.

## References

### Per-repo (this skill)

| Topic | Reference |
|---|---|
| Onboarding setup field mapping + wizard validation | `references/onboarding_setup_fields.md` |
| Subscription commerce — Discord identity + checkout flow | `references/nobletradingapp_subscription_commerce.md` |
| Landing page + marketing copy (canonical) | `references/nobletradingapp_landing_page_marketing.md` |
| Clerk role architecture (privateMetadata ONLY) + admin gate fix | `references/nobletradingapp_clerk_role_private_metadata.md` |
| Next.js 16 lint migration + hermes verify manifest | `references/nobletradingapp_next16_lint_and_verify.md` |
| Supabase anon RLS — read-only probe + studio-down diagnostics | `references/supabase_anon_rls_and_probes.md` |

### Cross-repo (→ noble-trader-stack)

| Topic | Reference |
|---|---|
| Plan entitlement model (license key eliminated) | `→ noble-trader-stack:references/license_rebuild_plan_prefix.md` |
| Three plugin surfaces (overview) | `→ noble-trader-stack:references/hermes_plugin_surfaces.md` |

## Repo-specific gotchas

- **`read_file`/`search_files`/`patch` fail on this repo** for both `C:\...` and
  `C:/...` forms (OneDrive + naming). Only `terminal` works. Native `python open()`
  ALSO fails on `C:/...` absolute forms — use `os.chdir` + relative path.
- **Next.js 16 removed `next lint`**: bare `npm run lint` fails with "Invalid project
  directory". Use `eslint .`.
- **`hermes verify` auto-detected Next recipe HANGS on start/readiness (Windows)**:
  server binds :3000 fine but readiness probe never completes (>600s). Use
  `--skip-start` or a saved manifest with a manual readiness check.
- **Two `openapi.yaml` copies**: `docs/openapi.yaml` + `docs/Setup/openapi.yaml`.
  Both must be updated on version bump.
- **`package.json` tab character**: `~line 2994` has a pre-existing tab that breaks
  YAML validators. Do NOT "fix" it — unrelated to current work.
- **Edge Functions deprecated**: `supabase/functions/` is DEPRECATED — document
  issues only, do NOT modify. Active Python paths are authoritative.
- **Discord webhook probe**: plain urllib to `discord.com/api/webhooks/*` → 403
  error code 1010 (Cloudflare browser-signature block). Fix: browser-like headers
  (User-Agent Chrome/126, Accept: application/json, Accept-Encoding: gzip) +
  decompress gzip body.
