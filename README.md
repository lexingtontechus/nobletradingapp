# Noble Trading App

> Subscription platform for crypto trading signals — built by **Algo Holdings LLC** & **0xDWEB INC**.
> Production target: [nobletrading.app](https://nobletrading.app)

Noble Trading App is a full-stack subscription commerce product that lets
traders subscribe to two tiers of real-time trade signals — **Signal Scout**
($79/mo) and **Precision Pro** ($199/mo) — paid in crypto via
[Helio / MoonPay Commerce](https://www.hel.io/), with automated renewal
reminders, Discord role sync, and **per-subscriber Redis ACL credentials**
for direct stream consumption by the subscriber's own trading bots.

---

## Table of Contents

1. [What this project does](#what-this-project-does)
2. [Subscription products](#subscription-products)
3. [Architecture at a glance](#architecture-at-a-glance)
4. [The hybrid auth pattern (Clerk + Supabase)](#the-hybrid-auth-pattern-clerk--supabase)
5. [Subscription lifecycle](#subscription-lifecycle)
6. [Redis credential lifecycle](#redis-credential-lifecycle)
7. [Renewal reminders (AgentMail)](#renewal-reminders-agentmail)
8. [Tech stack](#tech-stack)
9. [Project structure](#project-structure)
10. [Database schema (migrations)](#database-schema-migrations)
11. [Edge Functions (Supabase)](#edge-functions-supabase)
12. [Next.js API routes](#nextjs-api-routes)
13. [Environment variables](#environment-variables)
14. [Security model](#security-model)
15. [Local development](#local-development)
16. [Deployment](#deployment)
17. [Deprecated / archived code](#deprecated--archived-code)

---

## What this project does

A trader lands on the marketing site, picks a plan, signs in with Clerk, and
checks out via the embedded Helio widget (crypto-only — USDC on Solana by
default). Helio fires signed webhooks to a Supabase Edge Function which
records the subscription, syncs Clerk `publicMetadata` for instant UI
gating, and provisions a **per-subscriber Redis ACL user** with read-only
access to the `signals:*` streams.

The subscriber then opens their portal, reveals their bash-style env-var
panel (a Stripe-API-key-style reveal-once flow), and copies a
`REDIS_URL=rediss://...` plus their NTA API key into their bot config. Their
bot then consumes the live signal stream via `XREADGROUP`.

When the subscription expires (Helio `ENDED`), the same webhook revokes the
Redis ACL user in seconds. A daily cron sweep catches any stragglers.

Three days before each renewal, Supabase sends a reminder email via
[AgentMail.to](https://agentmail.to/) with a freshly-minted Helio charge
deep-link (Helio is configured as `isAnonymous=true`, so it sends no
emails of its own — Supabase owns the entire reminder cadence).

---

## Subscription products

Both plans are seeded in `supabase/migrations/0002_seed_plans.sql` and each
maps 1:1 to a Helio Subscription Pay Link.

| Plan             | Price      | Interval | What you get                                                        | Helio paylink env var            |
| ---------------- | ---------- | -------- | ------------------------------------------------------------------- | -------------------------------- |
| **Signal Scout** | $79.00/mo  | MONTH    | Entry-level trade signals + community access                        | `NEXT_PUBLIC_NTA_SIGNALSCOUT`    |
| **Precision Pro**| $199.00/mo | MONTH    | Premium signals, live alerts, advanced analytics. **Most popular.** | `NEXT_PUBLIC_NTA_PRECISIONPRO`   |

Each plan has its own:
- `renewal_reminder_days` (default 3 — start nagging 3 days before expiry)
- `grace_period_days` (default 3 — keep Redis access live during grace)
- `slug` (added in migration `0004` — powers human-readable stream names
  like `signals:signal_scout` instead of `signals:<uuid>`)

---

## Architecture at a glance

```
                                   ┌──────────────────────────────┐
                                   │         Clerk (auth)         │
                                   │  - JWT carries publicMetadata│
                                   │  - {subscriptionStatus, plan,│
                                   │     discordId, role}         │
                                   └──────────────┬───────────────┘
                                                  │ JWT (instant first paint)
                                                  ▼
┌───────────────┐    subscribe    ┌────────────────────────────────────┐
│               │ ──────────────▶ │            Next.js 16               │
│   Browser     │                 │  (App Router, Turbopack, React 19)  │
│  (portal +    │ ◀────────────── │                                     │
│   marketing)  │  instant UI     │  /              marketing site      │
└───────────────┘                 │  /pricing       plan cards          │
       ▲                          │  /portal        subscriber portal   │
       │                          │  /admin         revenue dashboard   │
       │                          │  /sign-in,up    Clerk Elements      │
       │                          │  /api/*         route handlers      │
       │                          └──────┬───────────────────┬─────────┘
       │                                 │                   │
       │                            create-sub            redis-credentials
       │                          (writes sub)         (decrypts + returns)
       │                                 │                   │
       │                                 ▼                   ▼
       │                          ┌──────────────────────────────────────┐
       │                          │     Supabase (Postgres + RLS)         │
       │                          │  users · plans · subscriptions ·      │
       │                          │  subscription_events ·                │
       │                          │  payment_transactions ·               │
       │                          │  reminder_emails · webhook_idempotency│
       │                          │  redis_credentials                    │
       │                          └──────────────┬───────────────────────┘
       │                                         │ pg_cron + pg_net
       │                                         ▼
       │  ┌──────────────────────────────────────────────────────────────┐
       │  │              Supabase Edge Functions (Deno)                 │
       │  │                                                              │
       │  │  helio-webhook  ←── Helio signed webhooks (STARTED/RENEWED/  │
       │  │                    ENDED) → updates subscriptions +          │
       │  │                    syncs Clerk publicMetadata +              │
       │  │                    calls redis-credentials-manager           │
       │  │                                                              │
       │  │  redis-credentials-manager  ←── provision / revoke / rotate   │
       │  │                    (ACL SETUSER / DELUSER on Redis)          │
       │  │                                                              │
       │  │  send-renewal-reminders  ←── daily 09:00 UTC cron            │
       │  │                    (queries v_reminders_due, mints a fresh   │
       │  │                    Helio charge, emails via AgentMail)       │
       │  │                                                              │
       │  │  sweep-expired-redis-creds  ←── daily 03:00 UTC cron         │
       │  │                    (catches creds the webhook missed)       │
       │  └──────────────────────────────────────────────────────────────┘
       │                                         │
       │                                         ▼
       │                          ┌──────────────────────────────────────┐
       └──────────────────────────│   External services                  │
                                  │   - Helio (MoonPay Commerce) — crypto│
                                  │     checkout + webhooks + Discord    │
                                  │     managed memberships bot          │
                                  │   - AgentMail.to — transactional     │
                                  │     email (renewal reminders)        │
                                  │   - Redis (TLS) — per-subscriber ACL │
                                  │     users reading signals:* streams  │
                                  └──────────────────────────────────────┘
```

---

## The hybrid auth pattern (Clerk + Supabase)

The portal needs to render the subscriber's badge **instantly** on first paint
(no spinner flash, no API call). But Supabase is the source of truth for
subscription state.

**Solution:** every *writer* mirrors the subscription state into the Clerk
user's `publicMetadata`. The *reader* (portal) reads from the JWT for instant
first paint, then refreshes from `/api/subscription-status`.

| Operation                | Writer                                | What it writes to `publicMetadata`                              |
| ------------------------ | ------------------------------------- | --------------------------------------------------------------- |
| User initiates checkout  | `app/api/create-subscription`         | `{ subscriptionStatus: 'pending', plan }`                       |
| Helio `STARTED`/`RENEWED`| `supabase/functions/helio-webhook`    | `{ subscriptionStatus: 'active', plan, discordId, role }`       |
| Helio `ENDED`            | `supabase/functions/helio-webhook`    | `{ subscriptionStatus: 'expired', plan, discordId, role }`      |
| User cancels             | `app/api/cancel-subscription`         | `{ subscriptionStatus: 'cancelled' }`                           |

The portal reads `user.publicMetadata.{subscriptionStatus, plan, discordId, role}`
straight from the Clerk JWT — **zero API calls on first paint** — then layers
the fresh `/api/subscription-status` response on top once it resolves.

`publicMetadata.role === 'admin'` also gates the `/admin` link in the portal
header.

> **Supabase remains the source of truth.** Clerk `publicMetadata` is a cache.
> If they ever diverge, the API call wins (the portal uses
> `effectiveStatus = sub?.status ?? instantStatus`).

---

## Subscription lifecycle

```
Browser                Next.js            Supabase             Helio
──────                 ──────             ────────             ─────
1. User clicks         POST /api/         INSERT subscriptions
   "Subscribe" ──────▶ create-subscription (status='pending') ──┐
                       + Clerk publicMetadata = 'pending'       │
                                                                │
2. <HelioCheckout       Renders Helio iframe ──▶ User pays in   │
    paylinkId=…         crypto                              ◀────┘
    additionalJSON=
      {sub_id} />

3. (onSuccess =         (UI feedback only)        Helio fires webhook:
    UI feedback)                                  POST /functions/v1/
                                                  helio-webhook
                                                  Header: Authorization: Bearer <token>
                                                  Header: X-Signature: <hmac-sha256>
                                                                │
                                                                ▼
                                            4. Edge Function:   │
                                               - verify bearer + HMAC
                                               - idempotency check (event_id)
                                               - parse event ∈ {STARTED,RENEWED,ENDED}
                                               - parse meta.customerDetails.additionalJSON
                                                 (JSON STRING — double-encoded, loop parse)
                                               - UPSERT subscriptions (status='active')
                                               - INSERT subscription_events
                                               - INSERT payment_transactions
                                               - capture discordUser.id + email
                                               - PATCH Clerk publicMetadata
                                               - call redis-credentials-manager(provision)

5. Daily 09:00 UTC:  pg_cron → Edge Function send-renewal-reminders
                       - query v_reminders_due
                       - POST /v1/charge/api-key → fresh nextChargeUrl
                         (Helio does NOT include it in webhooks)
                       - POST agentmail.to/v0/inboxes/{id}/messages/send
                         with Idempotency-Key: reminder-<subId>-<n>
                       - store message_id + thread_id + next_charge_url

6. User clicks charge URL → pays renewal → Helio fires RENEWED → loop to 4.

7. Grace period expires unpaid → Helio fires ENDED → subscription.status='expired'
   → Redis ACL user revoked → Discord role auto-removed by Helio's bot.
```

**Correlation key:** the `subscriptions.id` (uuid) created by Next.js is
passed to Helio via `additionalJSON` and echoed back in every webhook
payload — that's how we tie Helio events to the local subscription row
(Helio itself tracks identity only by wallet address).

---

## Redis credential lifecycle

Subscribers run their own trading bots that need **sub-millisecond
`XREADGROUP`** access to the live `signals:*` Redis Streams. We give each
subscriber their own Redis ACL user with strict least-privilege permissions
— no shared password, no `XADD`/`XTRIM`/`DEL`, no access to non-stream keys.

```
┌─────────────────────┐  STARTED / RENEWED  ┌────────────────────────────┐
│  helio-webhook      │ ──────────────────▶ │ redis-credentials-manager  │
│  (Edge Function)    │                     │   action=provision          │
└─────────────────────┘                     │   - ACL SETUSER sub_xxx >pwd│
                                            │     ~signals:* +ping +hello │
                                            │     +client +xread          │
                                            │     +xreadgroup +xgroup     │
                                            │     +xack +xpending +xclaim │
                                            │     +xinfo +xlen +xrange    │
                                            │     +xrevrange              │
                                            │   - AES-256-GCM encrypt pwd │
                                            │   - INSERT redis_credentials│
                                            └────────────┬───────────────┘
                                                         │
┌─────────────────────┐  ENDED              ┌────────────▼───────────────┐
│  helio-webhook      │ ──────────────────▶ │ action=revoke               │
└─────────────────────┘                     │   - ACL DELUSER sub_xxx    │
                                            │   - UPDATE revoked_at       │
┌─────────────────────┐  daily 03:00 UTC   └────────────┬───────────────┘
│ sweep-expired-redis │ ─────────────────────────────────▶ (catches stragglers:
│ -creds (cron)       │                                  subs expired but
└─────────────────────┘                                  webhook missed)

┌─────────────────────┐  POST rotate        ┌────────────────────────────┐
│ /api/redis-         │ ──────────────────▶ │ action=rotate (zero-downtime)│
│  credentials/rotate │                     │   1. ACL SETUSER >newpwd    │
│  (user-initiated)   │                     │      (both old + new work)  │
└─────────────────────┘                     │   2. UPDATE Supabase row    │
                                            │   3. ACL SETUSER <oldpwd    │
                                            │      (old instantly dead)   │
                                            └────────────────────────────┘
```

**Security hardening (7 controls):**

1. **TLS only** — admin and subscriber URLs both `rediss://`
2. **AES-256-GCM** at rest — passwords + API keys encrypted via Web Crypto
   (`REDIS_CRED_ENCRYPTION_KEY`, base64 of 32 random bytes; same key in
   Next.js + Edge Function envs)
3. **Shown-once + rotation** — Stripe-API-key-style reveal-once flow; users
   can rotate any time (zero-downtime swap)
4. **Strict least-privilege ACL** — read-only on `signals:*`, no
   `XADD`/`XTRIM`/`DEL`/`CONFIG`/`ACL`/`EVAL`
5. **Consumer groups** — one `XREADGROUP` cursor per subscriber
6. **Daily cron sweep** — catches credentials the webhook missed (Helio's
   12-retry exhaustion, manual cancels, webhook bugs)
7. **Production upgrade path** — if Redis Cloud ACL user limits are hit,
   swap to a WebSocket signal gateway (no Redis exposure to subscribers)

The subscriber's portal panel (`app/components/redis-credentials-panel.jsx`)
is a bash-style terminal with:
- macOS traffic-light header + zinc-950 dark mono background
- Syntax-highlighted env vars (KEY emerald / `=` zinc / VALUE amber)
- Hidden by default — fetch only happens **after** "Reveal credentials" click
  (prevents accidental exposure on screen-share)
- Per-line copy buttons + "Copy all" + "Download .env"
- "Rotate credentials" button with confirm modal
- Usage examples (test connection, create consumer group, tail signals)

The exposed env vars are:

```bash
REDIS_URL=rediss://sub_<hex>:<password>@redis.nobletrading.app:6379
REDIS_USERNAME=sub_<hex>
REDIS_PASSWORD=<32-char URL-safe>
REDIS_STREAM_SIGNALS=signals:signal_scout
REDIS_CONSUMER_GROUP=nta_<plan_slug>
NTA_PLAN=signal_scout
NTA_SUBSCRIPTION_ID=<uuid>
NTA_API_KEY=nta_<43-char base62>
```

---

## Renewal reminders (AgentMail)

Helio is configured with `isAnonymous=true` — it sends no emails. Supabase
owns the entire reminder cadence via a daily pg_cron job.

| What                  | Value                                                                              |
| --------------------- | ---------------------------------------------------------------------------------- |
| Cron schedule         | `0 9 * * *` (daily 09:00 UTC) via pg_cron + pg_net                                 |
| Edge Function         | `supabase/functions/send-renewal-reminders/index.ts`                               |
| View                  | `v_reminders_due` (active/grace subs within `renewal_reminder_days` of expiry, not reminded in last 24h) |
| Email provider        | AgentMail.to — `POST /v0/inboxes/{inbox_id}/messages/send`                         |
| Auth                  | `Authorization: Bearer am_...`                                                     |
| Idempotency           | `Idempotency-Key: reminder-<subId>-<reminderNumber>` (24h TTL, org-scoped)        |
| Retry                 | 429 → honor `Retry-After`; 5xx → exponential backoff; up to 4 attempts             |
| Charge deep-link      | Minted fresh via `POST /v1/charge/api-key` (Helio does NOT include `nextChargeUrl` in webhooks) |
| Tracking              | `message_id` + `thread_id` captured on `reminder_emails` row + `agentmail_thread_id` on `subscriptions` row |
| Dedup                 | `v_reminders_due` excludes subs reminded in last 24h + Idempotency-Key on send     |

---

## Tech stack

| Layer                | Choice                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| Web framework        | Next.js 16.0.7 (App Router, Turbopack)                                 |
| Language             | JavaScript (frontend) + TypeScript (Edge Functions)                    |
| Auth                 | Clerk (`@clerk/nextjs` v6, `@clerk/elements`) — hybrid publicMetadata  |
| Database             | Supabase Postgres + RLS (keyed on Clerk JWT `sub`)                     |
| Edge Functions       | Supabase Functions (Deno runtime)                                      |
| Payments             | Helio / MoonPay Commerce (`@heliofi/checkout-react` v4 + `@heliofi/sdk`) |
| Transactional email  | AgentMail.to (Idempotency-Key + retry/backoff)                         |
| Realtime signals     | Redis (TLS) with per-subscriber ACL users (Redis 6+)                   |
| Styling              | Tailwind CSS 4 + shadcn/ui (New York) + lucide-react                   |
| Charts               | Recharts 3                                                             |
| Cron                 | pg_cron + pg_net (Supabase Postgres extensions)                        |
| Discord roles        | Helio's managed Discord Memberships bot (auto role assign/remove)      |

---

## Project structure

```
nobletradingapp/
├── app/                              # Next.js App Router
│   ├── page.js                       # Marketing landing (/)
│   ├── layout.js                     # Root layout (ClerkProvider + ThemeProvider)
│   ├── globals.css                   # Tailwind v4 + theme tokens
│   ├── not-found.js
│   ├── pricing/page.jsx              # Plan cards + Helio checkout
│   ├── portal/page.jsx               # Subscriber portal (hybrid auth pattern)
│   ├── admin/                        # Revenue dashboard (admin role only)
│   │   ├── page.jsx                  # Tabbed dashboard (Summary / Signal Scout / Precision Pro / Memberships)
│   │   ├── components/               # Recharts chart components (line + bar)
│   │   ├── widget_*.jsx              # Server-component widgets querying new schema
│   │   └── _archive/                 # Deprecated widgets (old table refs removed)
│   ├── payment/success.jsx           # Post-checkout success page
│   ├── privacy/page.jsx
│   ├── terms/page.jsx
│   ├── sign-in/[[...sign-in]]/page.jsx   # Clerk Elements
│   ├── sign-up/[[...sign-up]]/page.jsx   # Clerk Elements
│   ├── waitlist/[[...waitlist]]/page.jsx
│   ├── components/
│   │   ├── home.jsx
│   │   ├── header.jsx
│   │   ├── footer.jsx                # Sticky footer
│   │   ├── checkout.jsx              # <HelioCheckout> wrapper
│   │   ├── subscription-card.jsx
│   │   ├── subscription-status-badge.jsx
│   │   ├── redis-credentials-panel.jsx   # Bash-style env-var reveal panel
│   │   ├── activeuser.jsx
│   │   ├── markdownrender.jsx
│   │   ├── logo.jsx
│   │   ├── waitlist.jsx
│   │   └── _archive/                 # Deprecated Discord→Plan flow
│   └── api/
│       ├── create-charge/route.js    # Mints a one-off Helio charge (legacy)
│       ├── create-subscription/route.js   # Insert pending sub + Clerk sync
│       ├── cancel-subscription/route.js   # Mark cancelled + Clerk sync
│       ├── subscription-status/route.js   # Fresh sub state for portal
│       ├── redis-credentials/route.js     # GET decrypted creds (reveal-once)
│       ├── redis-credentials/rotate/route.js  # POST rotate (zero-downtime)
│       ├── clerk/route.js             # Clerk webhook → users table sync
│       ├── protected/route.js         # Demo of Clerk-protected route
│       ├── nta/nta-data.js            # Static demo data for admin
│       └── _archive/                  # Deprecated Discord invite routes
│
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql                       # 7 tables + RLS + views (546 lines)
│   │   ├── 0002_seed_plans.sql                 # Signal Scout + Precision Pro
│   │   ├── 0003_add_agentmail_tracking.sql     # message_id + thread_id columns
│   │   ├── 0004_redis_credentials.sql          # redis_credentials table + plans.slug
│   │   └── 0005_add_redis_sweep_cron.sql       # pg_cron daily sweep
│   └── functions/
│       ├── helio-webhook/index.ts              # Webhook handler (~580 lines)
│       ├── send-renewal-reminders/index.ts     # AgentMail reminder cron (~392 lines)
│       ├── redis-credentials-manager/index.ts  # ACL provision/revoke/rotate (~406 lines)
│       └── sweep-expired-redis-creds/index.ts  # Daily cron safety net (~100 lines)
│
├── components/ui/                    # shadcn/ui (card, select, chart)
├── lib/utils.js                      # cn() helper
├── utils/
│   ├── roles.jsx                     # Admin role helpers
│   └── supabase/                     # SSR + browser Supabase clients
│       ├── server.js
│       ├── _server.js
│       └── client.js
├── public/                           # Static assets
├── proxy.jsx                         # Edge middleware (Clerk auth gate)
├── .env.example                      # All env vars documented
├── components.json                   # shadcn/ui config
├── next.config.mjs
├── postcss.config.mjs
├── jsconfig.json
├── tailwind.config.ts
├── package.json
└── yarn.lock
```

---

## Database schema (migrations)

All migrations are idempotent (`IF NOT EXISTS` / `ON CONFLICT`).

### `0001_init.sql` — core schema (7 tables + 4 views + RLS)

| Table                       | Purpose                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `users`                     | Local mirror of Clerk users + Discord identity + role             |
| `plans`                     | Subscription products (1:1 with Helio Subscription Pay Links)     |
| `subscriptions`             | **Central table** — one row per subscription lifecycle            |
| `subscription_events`       | Append-only audit log of every webhook event                      |
| `webhook_idempotency`       | Dedupes Helio's up-to-12× retries (event_id unique)               |
| `payment_transactions`      | One row per payment (initial + each renewal) — drives revenue charts |
| `reminder_emails`           | Audit of every renewal reminder sent                              |

**Views:**
- `v_active_subscriptions` — active + grace subs with user + plan details
- `v_revenue_summary` — monthly revenue by plan (drives admin bar charts)
- `v_subscription_counts_by_plan` — funnel counts by plan × status
- `v_reminders_due` — rows the reminder cron should email right now

**Subscription status enum:** `pending → active → grace → expired / cancelled`

**RLS:** all tables enabled. Browser uses anon key + JWT
(`auth.jwt() ->> 'sub' = clerk_user_id`). Edge Functions use service role key
(bypasses RLS).

### `0002_seed_plans.sql`
Seeds Signal Scout ($79/mo) + Precision Pro ($199/mo) with `ON CONFLICT`
upsert. Includes commented-out pg_cron schedule for the reminder job.

### `0003_add_agentmail_tracking.sql`
Adds delivery tracking columns:
- `reminder_emails.agentmail_message_id`, `agentmail_thread_id`,
  `delivered_at`, `bounced_at`
- `subscriptions.agentmail_thread_id` (so future reminders thread together)
- Partial index on `agentmail_message_id WHERE NOT NULL`

### `0004_redis_credentials.sql`
- Adds `plans.slug` (human-readable stream names — e.g. `signal_scout`)
- Creates `redis_credentials` table:
  `subscription_id`, `user_id`, `plan_id`, `redis_username` (unique),
  `password_cipher` + `password_iv` (AES-256-GCM base64),
  `password_version`, `api_key_cipher` + `api_key_iv` (optional NTA API key),
  `stream_name`, `consumer_group`, `created_at`, `rotated_at`, `revoked_at`
- 3 indexes + RLS (self-select only)

### `0005_add_redis_sweep_cron.sql`
pg_cron schedule: daily 03:00 UTC, calls the sweep Edge Function via
`pg_net.http_post` with `X-Supabase-Cron: true` header.

---

## Edge Functions (Supabase)

All written in TypeScript, deployed with `supabase functions deploy <name>`.

### `helio-webhook/index.ts` (~580 lines)
The webhook handler. Verifies `Authorization: Bearer <sharedToken>` +
`X-Signature` (HMAC-SHA256 of raw body). Dedupes via `webhook_idempotency`.
Parses `event ∈ {STARTED, RENEWED, ENDED}`. Parses
`transactionObject.meta.customerDetails.additionalJSON` (JSON STRING — may be
double-encoded, loop-parses up to 4×). UPSERTs `subscriptions`, inserts
`subscription_events` + `payment_transactions`, captures Discord identity,
syncs Clerk `publicMetadata`, calls `redis-credentials-manager`.

### `send-renewal-reminders/index.ts` (~392 lines)
Daily cron. Queries `v_reminders_due`, mints a fresh Helio charge via
`POST /v1/charge/api-key`, sends email via AgentMail with
`Idempotency-Key: reminder-<subId>-<n>`, retry/backoff on 429 + 5xx, captures
`message_id` + `thread_id`.

### `redis-credentials-manager/index.ts` (~406 lines)
Internal-only (auth via `X-Internal-Secret` header). Three actions:
- `provision` — `ACL SETUSER` with least-privilege rules, AES-encrypt password,
  INSERT row. Idempotent (no-op if active row exists).
- `revoke` — `ACL DELUSER` for every non-revoked row on the subscription.
- `rotate` — zero-downtime: `ACL SETUSER >newpwd` → UPDATE DB →
  `ACL SETUSER <oldpwd` (old instantly dead).

Uses `npm:ioredis@5.4.3` (Deno native `npm:` specifier — no install needed).

### `sweep-expired-redis-creds/index.ts` (~100 lines)
Daily cron safety net. Queries `redis_credentials JOIN subscriptions WHERE
revoked_at IS NULL AND subscriptions.status IN ('expired','cancelled')`.
`ACL DELUSER` + `UPDATE revoked_at` for each. Auth via either
`X-Internal-Secret` or `X-Supabase-Cron: true`.

---

## Admin dashboard widgets

The `/admin` page is gated by `publicMetadata.role === 'admin'` (hybrid auth —
no API call needed to show/hide the link). All widgets are **server components**
that query Supabase via the **service-role client** (`utils/supabase/_server.js`)
because RLS on the user-JWT client would limit them to the admin's own rows.

| Widget | Source | What it shows |
| --- | --- | --- |
| `widget_customers_summary` | `users` table (COUNT) | Total registered users + Discord-linked users |
| `widget_payments_summary` | `payment_transactions` + `plans` (current month) | Per-plan revenue cards with new/renewal split |
| `widget_payments_chart` | `v_revenue_summary` (YTD, all plans) | Stacked area chart: new vs renewal revenue per month |
| `widget_customers_signalscout` | `v_subscription_counts_by_plan` | Signal Scout funnel: active / grace / expired counts |
| `widget_customers_precisionpro` | `v_subscription_counts_by_plan` | Precision Pro funnel: active / grace / expired counts |
| `widget_payments_signalscout_chart` | `v_revenue_summary` (Signal Scout) | YTD monthly revenue area chart for Signal Scout |
| `widget_payments_precisionpro_chart` | `v_revenue_summary` (Precision Pro) | YTD monthly revenue area chart for Precision Pro |
| `widget_customers_chart` | `payment_transactions` (is_renewal=false) | Monthly new-subscriber bar charts, both plans |

**Old `widget_*` tables are gone.** The previous admin widgets queried tables
like `widget_customers_summary`, `widget_payments_chart`, `widget_pivot_count_signalscout`,
`widget_payments_chart_details`, etc. — none of which exist in the new schema.
Those widgets have been rewritten to query the new `users`, `payment_transactions`,
and `subscriptions` tables plus the `v_revenue_summary` and `v_subscription_counts_by_plan`
views. Dead widgets (`widget_customers_details`, `_ntawidget`, `realtime-chart`)
were archived to `app/admin/_archive/`.

---

## Next.js API routes

| Route                                            | Method | Purpose                                                       |
| ------------------------------------------------ | ------ | ------------------------------------------------------------- |
| `/api/create-subscription`                       | POST   | Insert pending subscription + mirror `pending` to Clerk       |
| `/api/cancel-subscription`                       | POST   | Mark cancelled + mirror `cancelled` to Clerk                  |
| `/api/subscription-status`                       | GET    | Fresh subscription state for portal                           |
| `/api/redis-credentials`                         | GET    | Decrypt + return active Redis credentials (reveal-once)       |
| `/api/redis-credentials/rotate`                  | POST   | User-initiated zero-downtime rotation                         |
| `/api/create-charge`                             | POST   | Mint a one-off Helio charge (legacy utility)                  |
| `/api/clerk`                                     | POST   | Clerk webhook → sync `users` table                            |
| `/api/protected`                                 | GET    | Demo of Clerk-protected route                                 |

---

## Environment variables

See `.env.example` for the full annotated list. Summary:

| Service       | Variables                                                                                              | Where              |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| Clerk         | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`                        | next.js            |
| Supabase      | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`               | next.js + supabase |
| Helio         | `NEXT_PUBLIC_HELIO_NETWORK`, `NEXT_PUBLIC_NTA_SIGNALSCOUT`, `NEXT_PUBLIC_NTA_PRECISIONPRO`,            | next.js + supabase |
|               | `HELIO_API_KEY`, `HELIO_API_TOKEN`, `HELIO_API_BASE_URL`, `HELIO_WEBHOOK_SHARED_TOKEN`                 | supabase           |
| AgentMail     | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_WEBHOOK_SECRET`,                                 | supabase           |
|               | `REMINDER_SUCCESS_URL`, `REMINDER_CANCEL_URL`                                                          | supabase           |
| Redis         | `REDIS_ADMIN_URL` (rediss:// admin), `REDIS_PUBLIC_URL` (subscriber-facing),                           | supabase + next.js |
|               | `REDIS_CRED_ENCRYPTION_KEY` (base64 32B — same in both envs),                                          | supabase + next.js |
|               | `INTERNAL_FUNCTION_SECRET` (hex random — same in both envs)                                             | supabase + next.js |
| Discord       | (optional — only if not using Helio's managed bot)                                                     | —                  |

Generate secrets with:
```bash
openssl rand -base64 32   # REDIS_CRED_ENCRYPTION_KEY
openssl rand -hex 32      # INTERNAL_FUNCTION_SECRET
```

---

## Security model

| Threat                                       | Mitigation                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Forged Helio webhook                         | `Authorization: Bearer <sharedToken>` + `X-Signature` HMAC-SHA256 of raw body                       |
| Helio webhook replay (up to 12 retries)      | `webhook_idempotency` table (event_id unique)                                                       |
| Double reminder emails                       | `Idempotency-Key: reminder-<subId>-<n>` (24h TTL) + `v_reminders_due` 24h exclusion                 |
| Subscriber reads another subscriber's data   | RLS keyed on `auth.jwt() ->> 'sub' = clerk_user_id`                                                 |
| Redis password leak at rest                  | AES-256-GCM encryption (`REDIS_CRED_ENCRYPTION_KEY`, base64 32B)                                    |
| Redis password leak in browser cache         | `Cache-Control: no-store` on `/api/redis-credentials` + reveal-once flow (no fetch until click)     |
| Subscriber writes to / deletes streams       | Strict ACL: `~signals:*` + read commands only; no `XADD`/`XTRIM`/`DEL`/`CONFIG`/`ACL`/`EVAL`        |
| Stale Redis credentials after missed webhook | Daily sweep cron (`sweep-expired-redis-creds`) at 03:00 UTC                                         |
| Service role key leak                        | Server-only (no `NEXT_PUBLIC_` prefix); never imported in client components                         |
| Man-in-the-middle on Redis traffic           | TLS only (`rediss://`) for both admin and subscriber URLs                                           |

---

## Local development

```bash
# 1. Install deps
yarn install

# 2. Copy env vars
cp .env.example .env.local
# Fill in Clerk, Supabase, Helio, AgentMail, Redis values

# 3. Run the database migrations (in Supabase SQL editor, in order):
#    0001_init.sql → 0002_seed_plans.sql → 0003_add_agentmail_tracking.sql
#    → 0004_redis_credentials.sql → 0005_add_redis_sweep_cron.sql

# 4. Deploy Edge Functions
supabase functions deploy helio-webhook
supabase functions deploy send-renewal-reminders
supabase functions deploy redis-credentials-manager
supabase functions deploy sweep-expired-redis-creds

# 5. Set Supabase secrets
supabase secrets set \
  CLERK_SECRET_KEY=sk_test_... \
  HELIO_API_KEY=... \
  HELIO_API_TOKEN=... \
  HELIO_API_BASE_URL=https://api.dev.hel.io \
  HELIO_WEBHOOK_SHARED_TOKEN=... \
  AGENTMAIL_API_KEY=am_... \
  AGENTMAIL_INBOX_ID=reminders@nobletrading.agentmail.to \
  REMINDER_SUCCESS_URL=http://localhost:3000/portal \
  REMINDER_CANCEL_URL=http://localhost:3000/portal \
  REDIS_ADMIN_URL=rediss://default:pwd@redis.local:6379 \
  REDIS_CRED_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  INTERNAL_FUNCTION_SECRET=$(openssl rand -hex 32)

# 6. Schedule the pg_cron jobs (run once in Supabase SQL editor):
#    - send-renewal-reminders (daily 09:00 UTC) — see 0002_seed_plans.sql footer
#    - sweep-expired-redis-creds (daily 03:00 UTC) — see 0005_add_redis_sweep_cron.sql

# 7. Start the dev server
yarn dev
# → http://localhost:3000
```

> **Note on `next lint`:** Next.js 16 removed `next lint`. The `lint` script
> in `package.json` is a no-op / errors. Use ESLint directly if needed:
> `npx eslint app/`.

---

## Deployment

### Frontend (Next.js)
Deploy to Vercel (recommended) or any Node 20+ host. Set all `next.js` env
vars from `.env.example` in the host dashboard. Build command `yarn build`,
start command `yarn start`.

### Backend (Supabase)
- Migrations: run in Supabase SQL editor (or via `supabase db push`).
- Edge Functions: `supabase functions deploy <name>` for each.
- Secrets: `supabase secrets set ...` (see Local Development step 5).
- pg_cron: schedule the two jobs once via SQL editor.

### Redis
Use any Redis 6+ provider with TLS + ACL support:
- **Upstash** — managed Redis with ACL support
- **Redis Cloud** — managed, ACL on Pro tier+
- **Self-hosted** — Redis 6+ with `aclfile` configured

The admin URL needs a user with `ACL` management privileges. The default
user works on self-hosted Redis 6+; on Redis Cloud, use the account-level
admin credentials.

### Production upgrade path (if Redis Cloud ACL limits hit)
Swap the per-subscriber ACL approach for a **WebSocket signal gateway**:
a Next.js or standalone WebSocket server that authenticates via Clerk JWT
and proxies `XREADGROUP` calls to Redis on the subscriber's behalf.
Subscribers never see Redis credentials — most secure, but adds latency
(~1 hop) and a moving part.

---

## Deprecated / archived code

The original Discord→Plan flow (Discord invite → role check → plan select)
has been **archived, not deleted**. Files live in `_archive/` folders (which
Next.js App Router treats as private — not routed):

- `app/_archive/discord-flow/portal_page.jsx` — old portal
- `app/_archive/README.md` — explains what each file was and how to roll back
- `app/api/_archive/discord/route.js`
- `app/api/_archive/discord-invite/route.js`
- `app/components/_archive/` — `discord.jsx`, `discordinvite.jsx`,
  `discordno.jsx`, `discordyes.jsx`, `logoDiscord.jsx`, `selectplans.jsx`,
  `checkoutsignalscout.jsx`, `checkoutprecisionpro.jsx`

The new flow uses **Helio's managed Discord Memberships bot** — Helio
handles Discord role assign/remove natively based on subscription state.
No custom Discord bot is needed.

---

## License

Proprietary. © Algo Holdings LLC & 0xDWEB INC. All rights reserved.

---

## Maintainers

Built and maintained by **Algo Holdings LLC** & **0xDWEB INC**.
Production: [nobletrading.app](https://nobletrading.app)
