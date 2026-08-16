# Agent Instructions — nobletradingapp

> **Repo:** `nobletradingapp` · **Role:** Subscription commerce platform (marketing site + portal + admin) · **Tech:** Next.js 16 App Router

## Version
Verify version consistency: backend version bumps must update BOTH `openapi.yaml` copies + `tests/test_version_consistency.py` (asserts exact version). The nobletradingapp version is tracked via `package.json` + the pricing copy in `app/pricing/page.jsx`.

## Tech Stack
- **Framework:** Next.js 16.0.7 (App Router, Turbopack, React 19) — NO `src/` dir, app lives at `app/`
- **Auth:** Clerk (`@clerk/nextjs` v6, `@clerk/elements`) — hybrid publicMetadata pattern
- **Database:** Supabase Postgres + RLS (keyed on Clerk JWT `sub`)
- **Edge Functions:** Supabase Functions (Deno) — `helio-webhook`, `redis-credentials-manager`, `talaria-check`, `send-renewal-reminders`, `sweep-expired-redis-creds`, `license-validate`, `symbols-for-plan`
- **Payments:** Helio / MoonPay Commerce (`@heliofi/checkout-react` v4 + `@heliofi/sdk`)
- **Transactional email:** AgentMail.to (renewal reminders)
- **Realtime signals:** Redis (TLS) with per-subscriber ACL users
- **Styling:** Tailwind CSS 4 + shadcn/ui + lucide-react
- **Charts:** Recharts 3
- **Cron:** pg_cron + pg_net (Supabase Postgres extensions)
- **Lint:** `eslint .` only (next lint REMOVED, flat config, legacy baseline)

## Auth Architecture: The Hybrid Auth Pattern
Every writer mirrors subscription state into Clerk `publicMetadata`; the reader (portal) reads from the JWT for instant first paint, then refreshes from `/api/subscription-status`.

| Operation | Writer | What writes to `publicMetadata` |
|---|---|---|
| User initiates checkout | `app/api/create-subscription` | `{ subscriptionStatus: 'pending', plan }` |
| Helio STARTED/RENEWED | `supabase/functions/helio-webhook` | `{ subscriptionStatus: 'active', plan, discordId, role }` |
| Helio ENDED | `supabase/functions/helio-webhook` | `{ subscriptionStatus: 'expired', plan, discordId, role }` |
| User cancels | `app/api/cancel-subscription` | `{ subscriptionStatus: 'cancelled' }` |

**Supabase remains the source of truth.** Clerk `publicMetadata` is a cache. The portal uses `effectiveStatus = sub?.status ?? instantStatus`.

`/api/me` reads Clerk privateMetadata DIRECTLY — do NOT switch to the Supabase `users` table. The `users.role` column is a lazy mirror written ONLY by 3 upsert paths (create-subscription, subscription-status first-visit, talaria-claim). There is NO Clerk webhook. Table-only source → `role=null` for users who never hit an upsert path (admin UI hidden via `header.jsx`).

## Project Structure
```
nobletradingapp/
├── app/                    # Next.js App Router
│   ├── page.js             # Marketing landing
│   ├── layout.js           # Root layout (ClerkProvider + ThemeProvider)
│   ├── globals.css
│   ├── pricing/page.jsx    # Plan cards + Helio checkout (PLAN_COPY keyed by title)
│   ├── portal/page.jsx     # Subscriber portal
│   ├── admin/              # Revenue dashboard (admin role only)
│   ├── payment/success.jsx
│   ├── sign-in/[[...sign-in]]/page.jsx
│   ├── sign-up/[[...sign-up]]/page.jsx
│   ├── components/
│   │   ├── talaria-credentials-panel.jsx  # Claim-token reveal panel
│   │   ├── talaria-plugin-download-panel.jsx  # Precision Pro plugin download (gated on plan title containing "precision")
│   │   └── redis-credentials-panel.jsx   # DEPRECATED
│   └── api/
│       ├── plans/route.js
│       ├── create-subscription/route.js
│       ├── cancel-subscription/route.js
│       ├── subscription-status/route.js
│       ├── talaria-claim/route.js
│       ├── redis-credentials/route.js   # DEPRECATED surface
│       ├── helio-sync/route.js          # Triggers helio-subscription-sync edge fn
│       └── me/route.js
├── docs/
│   └── marketing/                       # Canonical copy: talaria-plugin, signal-scout, precision-pro
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── scripts/
└── AGENTS.md                           # This file (USER-authored, do not auto-regenerate)
```

## Subscription Products
| Plan | Price | Symbols | Most popular? |
|---|---|---|---|
| Signal Scout | $199/mo | 10 | No |
| Precision Pro | $599/mo | 20 | Yes |

Marketing one-pagers are canonical copy in `docs/marketing/` (`talaria-plugin`, `signal-scout`, `precision-pro`). The landing `app/page.js` + pricing `app/pricing/page.jsx` use `PLAN_COPY` keyed by title (keep Supabase fetch + CheckoutButton wiring).

## Environment
- `.env.example` — every env var documented.
- `.env.local` — secrets. **NEVER modify user config files during system updates.**
- TradingView API key should be protected (Bitwarden).

## Related Repos
| Repo | Role |
|---|---|
| `noble-trader-fastapi-backend` | Signal producer (sweeps, writes `nt_sweep_result`, Supabase Realtime broadcast) |
| `noble-trader-talaria` | Client plugin + tools + cron notifiers + Supabase migrations |
| `noble-trader-hermes-plugins` | Hermes desktop + dashboard plugins (mirror) |
| `noble-trader-hermes-agent-profile` | Hermes profile distribution |
| `noble-trader-proxy` | Read-only Redis→HTTP quote proxy (being retired) |

## Workflow
**THE WORKFLOW = Plan > Iterate > Build Code > Review/Summarize > Approve Push Git.**
- "Build Code" gate is strict — no edits without explicit authorization.
- Assessment mode = analysis+recommendations ONLY, no code/edits.
- User drives architecture; present scoped plan + let them confirm before building.
- "push git" is the separate final gate — explicit approval required for every commit/push.
- Severity-batch auth for backend fixes: `critical` → `high` → `m1,m4,…` → `lows`.

## Linting
```bash
eslint .
```
Next lint is REMOVED (flat config, legacy baseline). AGENTS.md is USER-authored — Next.js's `generate-agent-files.js` only writes when the `nextjs-agent-rules` block is MISSING, never regenerates.
