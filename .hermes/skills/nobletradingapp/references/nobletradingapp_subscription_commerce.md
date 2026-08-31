# noble-tradingapp Subscription Commerce — Discord Identity + Checkout Flow

## Discord identity = captured by MOONPAY/HELIO at checkout

Discord identity is captured by MoonPay/Helio at checkout — NOT by any join
flow the app builds. The Helio paylink has a managed Discord-membership
integration ("Discord Membership — Includes Discord access" shows in the
checkout widget); Helio auto-joins the buyer to the guild + assigns the role on
payment, and the webhook payload carries
`transactionObject.meta.customerDetails.discordUser = { id, username }`
(parsed at `supabase/functions/helio-webhook/index.ts:334`).

**Do NOT build a Discord OAuth2 / authorize-callback flow for nobletradingapp
join verification — the user explicitly called that the wrong architecture
(2026-08-08).** The OAuth routes (`app/api/discord/authorize` +
`app/api/discord/callback`) were ADDED in a prior session, user corrected, and
**DELETED this session** (commit `ddc4a11`). They are gone — do not resurrect them.

## Webhook is the ONLY writer of discord identity

| File:Line | What it writes |
|---|---|
| `helio-webhook/index.ts:425-426` | `helio_discord_id`/`helio_discord_username` on the subscriptions row |
| `helio-webhook/index.ts:519-520` | `users.discord_id` + `users.discord_username` (the "update sb after join" step) |
| `helio-webhook/index.ts:542` | mirrors `discordId` into Clerk `publicMetadata` (hybrid auth pattern) |

The portal reads `users.discord_id` (`app/api/subscription-status/route.js`) →
onboarding checklist.

The old `app/api/discord/route.js` member-search route (a) never wrote to
Supabase (only Clerk metadata), (b) had a **double-quote interpolation bug** —
`"https://discord.com/...members/search?...&query=${username}"` in double quotes
does NOT interpolate in JS (only backticks), so Discord received the literal
`${username}` → matched nothing. General JS pitfall: `${}` interpolation
requires backticks. It is now marked DEPRECATED (kept only for the unrouted
`_page.jsx`).

## Checkout wiring (BUILT, commit `ddc4a11`, 2026-08-08)

The component that mints the pending row + passes `additionalJSON.subscription_id`
is `app/components/checkout.jsx` (`CheckoutButton`). It was previously imported
by NO live page (dead loop: `Portal NoSubscriptionCard → /pricing → "Manage in
Portal" → Portal`); old widgets without `additionalJSON` made the webhook 400 →
no SB/Clerk/Discord sync. Now wired:

| Route | Method | Purpose |
|---|---|---|
| `app/api/plans/route.js` | GET | `GET /api/plans` → active plans from `plans` table (service-role, includes `helio_paylink_id`). **DB is the single source of truth for paylink IDs** — no hardcoded `NEXT_PUBLIC_NTA_*` in components. |
| `app/components/plan-selector.jsx` | — | Fetches `/api/plans`, renders each plan card with `CheckoutButton`. |

Portal `NoSubscriptionCard` embeds `<PlanSelector />`; `/pricing` signed-in gets
`<CheckoutButton plan={plan} />`.

**Change plan = cancel current → subscribe new** (user decision):
`SubscriptionCard` Cancel → `POST /api/cancel-subscription` → status
`cancelled` → 15s poll re-renders → `NoSubscriptionCard` + `PlanSelector` →
subscribe to the new plan. Unique index
`subscriptions_one_active_per_plan_idx (user_id, plan_id) WHERE status IN
('pending','active','grace')` only blocks a second ACTIVE row for the SAME
plan; cancelling frees the slot. Helio's bot handles Discord removal on cancel —
the app never touches roles.

Env vars: `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`/`DISCORD_GUILD_ID` NOT
needed (OAuth retired); paylink Discord-membership setting lives in the Helio
dashboard, not app env.

Full flow diagram + file:line evidence:
`noble-trader-workspace-maintenance → references/nobletradingapp_checkout_and_discord_flow.md`.

## PORTAL CREDENTIAL SURFACE = TALARIA CLAIM-TOKEN PANEL

The subscriber-facing credentials panel in `/portal` is now
`app/components/talaria-credentials-panel.jsx` — it mints via
`POST /api/talaria-claim` (active/grace only, 30-day expiry,
single-active-token policy) and shows a copyable/downloadable bundle for the
Hermes Talaria plugin:
```
SUPABASE_URL=https://pcvscowltlrxzgxjurcr.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   (PUBLIC anon key — safe to embed in the distributed plugin)
TALARIA_CLAIM_TOKEN=<64-hex, minted once>
TALARIA_PLAN=<plan_slug>
TALARIA_EXPIRES_AT=<ISO>
```
`app/components/redis-credentials-panel.jsx` is now DEPRECATED (the Redis ACL
provision/revoke/rotate flow still runs server-side for bot stream access; the
portal just no longer reveals Redis creds). Token stored only as SHA-256 hash
in `talaria_claims` (migration 0006); `talaria-check` Edge Function re-checks
the live `subscriptions` row on every call. See `talaria` skill +
`references/nobletradingapp_talaria_panel_swap.md` (full detail + fixed SB URL/pubkey values).