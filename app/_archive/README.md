# Archived / Deprecated — Discord → Plan flow

These files implement the **old** subscription onboarding flow that gated plan
display behind a Discord join (using a custom polling bot). They are kept here
for reference and rollback — **do not wire them back into the app**.

## Why they were deprecated

The new flow (see `app/portal/page.jsx`, `app/api/subscription-status/route.js`,
`app/components/subscription-card.jsx`, `app/components/checkout.jsx`) replaces
this pattern with:

1. **Plans are visible always.** Discord is a soft onboarding step in the
   portal's checklist, not a gate.
2. **No Discord polling bot.** Helio's managed Discord Memberships bot assigns
   the role automatically when a subscription goes `active`, and removes it
   when it goes `expired`. We don't need `/api/discord` (guild member poll) or
   `/api/discord-invite` (1-use invite minter) anymore.
3. **Single source of truth.** Subscription state lives in the `subscriptions`
   table; the portal reads it via `/api/subscription-status`. The old flow
   polled Clerk `user.reload()` every 30s and read `publicMetadata.discord`.
4. **Webhook-driven.** The Helio webhook (`supabase/functions/helio-webhook`)
   is authoritative; `onSuccess` is UI-only. The old flow relied on the client
   to detect payment and update Clerk metadata.

## What's in here

| File | Original location | Purpose (deprecated) |
|---|---|---|
| `portal_page.jsx` | `app/portal/_page.jsx` | Old portal: gated plans behind Discord join |
| `discord.jsx`, `discordinvite.jsx`, `discordno.jsx`, `discordyes.jsx`, `logoDiscord.jsx` | `app/components/` | Discord UI components + polling |

The matching deprecated API routes live at:
- `app/api/_archive/discord/route.js` — polled the Discord guild every 60s
- `app/api/_archive/discord-invite/route.js` — minted 1-use Discord invites

And the deprecated per-plan checkout buttons:
- `app/components/_archive/checkoutsignalscout.jsx`
- `app/components/_archive/checkoutprecisionpro.jsx`
- `app/components/_archive/selectplans.jsx` (used both)

These are replaced by the single data-driven `app/components/checkout.jsx`
which reads the paylinkId from the plan row.

## If you need to roll back

Move the files back to their original locations (drop the `_archive/` segment
and rename `portal_page.jsx` → `_page.jsx`) and remove the new
`app/portal/page.jsx`. But you almost certainly don't want to — the new flow is
strictly better.
