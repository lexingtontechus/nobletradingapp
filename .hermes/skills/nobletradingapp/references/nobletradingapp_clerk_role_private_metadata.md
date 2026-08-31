# nobletradingapp — Clerk role architecture (privateMetadata ONLY) + admin gate fix

Verified live 2026-08-09 (user-stated design, then root-caused + fixed).

## The design (user-stated, non-negotiable)

- `publicMetadata` stays **NULL for ALL users** — role is deliberately NOT there.
- The admin role lives **only in Clerk `privateMetadata.role = "admin"`** (server-readable, invisible to the browser SDK).
- Regular users have no role (or "member").
- **DO NOT promote role to public metadata** to make it client-readable — I attempted that (7 admins patched), the user rejected it mid-session, and it was reverted. Public-null is the design.

## Symptom

Admin page would not open: `utils/roles.jsx` `checkRole` crashed
`Cannot read properties of undefined (reading 'role')` at
`sessionClaims?.metadata.role` (sessionClaims exists but `.metadata` is
undefined for standard sessions), and even when null-safe it returned false
because it only read `publicMetadata.role` — always null. `app/admin/page.jsx`
redirects to `/` when `checkRole("admin")` is false.

## Root-cause chain

1. Roles were provisioned into **privateMetadata** (`GET /v1/users` shows
   `private_metadata.role: "admin"` for the 7 admins, `public_metadata: {}` for everyone).
2. Every app consumer read `publicMetadata.role` → always null → admin never passes.
   Consumers: `checkRole` (utils/roles.jsx), header.jsx Admin link
   (`user?.publicMetadata.role == "admin"`), portal/page.jsx `isAdmin`
   (`pm.role === "admin"`), and the `users.role` writes in
   create-subscription / subscription-status / talaria-claim.
3. The browser SDK (`useUser()`) exposes only public metadata — client
   components CANNOT see private metadata by design.

## The fix (all verified + build gate passed)

| File | Change |
|---|---|
| `utils/roles.jsx` | Null-safe fast path `sessionClaims?.metadata?.role`, then `clerkClient().users.getUser(userId)` → `publicMetadata?.role === role \|\| privateMetadata?.role === role` (try/catch → false) |
| `app/api/me/route.js` | NEW — server endpoint `GET /api/me` → `{ userId, role: "admin" \| "member" \| null }` computed from public+private metadata. This is the canonical bridge: the browser can't read private metadata, so client components ask the server |
| `app/components/header.jsx` | Admin `UserButton.Link` gated on `isAdmin` state from `fetch("/api/me")` (useEffect on `isLoaded`, cancelled flag) |
| `app/portal/page.jsx` | `isAdmin = serverRole === "admin" \|\| instantAdmin` with `/api/me` fetch; `instantAdmin` kept as harmless fast-path |
| `app/api/create-subscription/route.js` | `users.role` write now `publicMetadata?.role === "admin" \|\| privateMetadata?.role === "admin" ? "admin" : "member"` |
| `app/api/subscription-status/route.js` | same |
| `app/api/talaria-claim/route.js` | same |

Also patched the live Supabase `users` row for the real admin
(`clerk_user_id in (...)` → PATCH role=admin via REST) because
create-subscription had previously written "member" from the null public
metadata.

## Verification recipe

- List roles: `GET https://api.clerk.com/v1/users?limit=100` with `Authorization: Bearer <CLERK_SECRET_KEY>` → compare `public_metadata.role` (expect null) vs `private_metadata.role` (expect "admin" for the 7 admins).
- Simulate checkRole for a user: fetch `/v1/users/{id}`, evaluate `pub==="admin" || priv==="admin"`.
- Build gate: `npm run build` — `/admin` and `/api/me` must appear in the route table.
- `proxy.jsx` middleware only guards `/dashboard(.*)` (not a real route) — it does NOT block `/admin`; the page-level `checkRole` is the gate.

## Admin page audit (same session, cleanup)

The 8 active admin widgets all query live tables/views (verified with data):
`users`, `payment_transactions` (+ `plans!inner(title)` join — live 200),
`v_revenue_summary` (2 rows), `v_subscription_counts_by_plan` (3 rows).
5 dead files referencing non-existent tables/views were moved to
`app/admin/_archive/` (`widget_customers_details.jsx` → table
`widget_customers_details`; `_ntawidget.jsx` → `vwidget_customers`;
`components/realtime-chart.jsx` → typo'd `widget_payments_precisonpro`;
`_widget.jsx` → `/api/nta-data`; `components/example2.jsx` → hardcoded demo).
`_archive/README.md` documents the rollback pattern. Class rule: cross-check
every admin widget's `.from(...)` against the LIVE schema before touching it
(search_files fails on this OneDrive repo root — use terminal grep; the
management-API SQL endpoint needs an `sbp_` PAT, not the publishable key).
