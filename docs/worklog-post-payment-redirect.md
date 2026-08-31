# Worklog: Post-Payment Redirect to Token-Claimed View

> **Status:** Planning / Scoped
> **Date:** 2026-08-28
> **Author:** Hermes Agent (assessment)
> **Related:** `app/portal/page.jsx`, `app/payment/success/page.jsx`, `app/api/talaria-claim/route.js`, `app/components/talaria-credentials-panel.jsx`

## 1. Problem Statement

After a user logs in → subscribes → gets a token, there is no directed redirect to a "you're set up" view. The current flow lands users on `/payment/success` (which polls for webhook confirmation) and then offers a manual "Go to your portal" link. The user then arrives at `/portal`, which shows either a subscription card or a "Choose a plan" card depending on plan status.

**Request:** Create a workflow to redirect the user to a new page after they complete payment and receive their claim token. The portal page should perform a plan-status check:
- If `plan status = false` (no active subscription) → show the portal page as-is (plan picker / onboarding).
- If `plan status = active` → redirect to / show the new token-claimed view.

## 2. Current State (Assessment)

### 2.1 Subscription Lifecycle (existing, working)
```
1. User picks a plan on /pricing → POST /api/create-subscription
   → creates a `pending` row in Supabase `subscriptions` table
   → mirrors { subscriptionStatus: 'pending', plan } into Clerk publicMetadata
   → returns { subscriptionId, paylinkId } to CheckoutButton

2. CheckoutButton renders HelioCheckout widget with additionalJSON.subscription_id
   → Helio widget onSuccess → redirects to /payment/success?sub=<id>

3. /payment/success polls GET /api/subscription-status every 3s
   → webhook-helio-sync edge fn also invoked via /api/helio-sync (best-effort)
   → when row flips to `active`, shows "Payment confirmed!" + "Go to your portal" link

4. Webhook (helio-webhook edge fn) handles STARTED/RENEWED/ENDED:
   → updates subscriptions.status to 'active' / 'expired'
   → provisions/revoke Redis credentials
   → mirrors { subscriptionStatus, plan, discordId } into Clerk publicMetadata
   → inserts payment_transactions + subscription_events

5. User lands on /portal
   → reads publicMetadata for instant first paint (hybrid auth pattern)
   → fetches /api/subscription-status for detailed data
   → shows SubscriptionCard (if active/grace/pending) or NoSubscriptionCard (PlanSelector)
   → for active subs: shows TalariaCredentialsPanel (claim token) + TalariaPluginDownloadPanel
```

### 2.2 Token System (existing, working)
- **POST /api/talaria-claim** — mints a 32-byte hex claim token (SHA-256 hashed at rest)
  - Requires active/grace subscription (`403 no_active_subscription` otherwise)
  - Single-active-token policy: revokes previous claims
  - 30-day TTL
  - Returns `{ token, expires_at, plan_title, plan_slug }`
- **TalariaCredentialsPanel** (client component) — calls /api/talaria-claim on reveal click
  - Hidden by default, revealed via "Reveal credentials" button
  - Shows token in a bash-like env file format

### 2.3 Plan Status Sources
Two sources of truth for subscription status:
1. **Clerk publicMetadata.subscriptionStatus** — cached in JWT, instant first paint, written by webhook + create-subscription + cancel-subscription
2. **Supabase `subscriptions.status`** — authoritative, queried by `/api/subscription-status` with `.in("status", ["pending", "active", "grace"])`

Effective status in portal: `const effectiveStatus = sub?.status ?? instantStatus ?? null`

### 2.4 What's Missing
- No redirect from `/payment/success` → a dedicated "token claimed / welcome" page once the subscription confirms active
- No plan-status gate on any dedicated post-purchase page
- The `/payment/success` page currently just offers a manual link to the portal

## 3. Proposed Workflow Design

### 3.1 New Route: `/welcome` (or `/onboarding/complete`)
A dedicated landing page for users who have just completed payment and confirmed their subscription. This page:
1. **Server-side plan status check** — wraps in a server component that fetches `/api/subscription-status` (or reuses the server client directly)
2. **If no active subscription** → redirect to `/portal` (the plan picker / onboarding view)
3. **If active subscription** → render the welcome/token view showing:
   - Confirmation that the subscription is active
   - Plan name + billing details (next renewal date)
   - The Talaria claim token (auto-reveal, since they just paid) — or a "Reveal credentials" button
   - Link to the portal for ongoing management
   - Link to the Talaria plugin download (for Precision Pro)

### 3.2 Redirect from `/payment/success`
Modify `app/payment/success/page.jsx`:
- Current: on `status === "active"`, shows "Payment confirmed!" + manual "Go to your portal" link
- New: on `status === "active"`, **automatically redirect** (client-side `useRouter().push("/welcome")`) after a brief success flash, OR replace the "Go to your portal" CTA with a direct link to `/welcome`

### 3.3 Portal Plan-Status Gate
Modify `app/portal/page.jsx`:
- Add a server-side (or client-side via `useSearchParams`) plan-status check at the top of the page
- If `effectiveStatus` is `'active'` or `'grace'` → the user is subscribed and could be redirected to `/welcome` on first visit after subscribing
- If `effectiveStatus` is `null` / `'expired'` / `'cancelled'` → show the portal page normally (plan picker / re-subscribe)

**Key design decision:** The portal already handles showing the right content based on status. The "redirect to new page if active" behavior should be **conditional and intentional** — perhaps only when a query param like `?redirected=true` or `?welcome=true` is present (set by the success page), rather than always redirecting active users away from the portal (which they may bookmark to manage their subscription).

### 3.3 Recommended: Query-Param-Gated Redirect in Portal
```
/portal?welcome=true
```
- The `/payment/success` page links to `/portal?welcome=true` (or `/welcome`)
- The portal checks: if `welcome=true` in search params AND the subscription is active/grace → render the new welcome view inline OR redirect to `/welcome`
- This preserves the portal as a stable management destination while enabling the post-purchase onboarding flow

## 4. Implementation Plan

### Phase 1: New `/welcome` Page
**File:** `app/welcome/page.jsx` (new)

A server component that:
1. Calls `GET /api/subscription-status` server-side (via internal fetch or direct Supabase)
2. If no active/grace subscription → `redirect("/portal")` (Next.js `redirect()` from `next/navigation`)
3. If active → render:
   - Success banner ("Your subscription is active!")
   - Plan details card (title, price, renewal date)
   - **TalariaCredentialsPanel** (auto-revealed, since payment just confirmed)
   - **TalariaPluginDownloadPanel** (if Precision Pro)
   - CTA buttons: "Go to Portal" (management), "View Talaria docs"
   - Onboarding checklist (completed, with links to each step)

**Plan status check logic:**
```js
// From /api/subscription-status response
const hasActive = sub && ["active", "grace"].includes(sub.status)
if (!hasActive) redirect("/portal")
```

### Phase 2: Update `/payment/success`
**File:** `app/payment/success/page.jsx` (modify)

Current "active" state renders:
```jsx
<Link href="/portal" className="btn btn-primary">Go to your portal</Link>
```
Change to:
```jsx
<Link href="/welcome" className="btn btn-primary">Continue to Talaria setup</Link>
```
Or auto-redirect after 2s of showing the confirmation.

### Phase 3: Plan-Status Gate in Portal
**File:** `app/portal/page.jsx` (modify)

Add a check at the top of the component:
```js
// Client-side — check search params for welcome flag
const searchParams = useSearchParams()
const shouldWelcome = searchParams.get("welcome") === "true"

// After fetching subscription status:
if (shouldWelcome && effectiveStatus === "active") {
  // Option A: client-side redirect
  useRouter().replace("/welcome")
  // Option B: render the welcome view inline
  return <WelcomeView subscription={sub} />
}
```

**Recommendation:** Use Option A (redirect to `/welcome`) for clean URL + SSR, with a `?from=portal` param to allow "back to portal" navigation.

### Phase 4: Edge Cases & Fallbacks

| Scenario | Handled By | Behavior |
|---|---|---|
| Webhook delayed (>3s) | `/payment/success` polling | Stays in "pending" state, polls, then redirects to `/welcome` |
| User navigates to `/welcome` directly (no sub) | `/welcome` server check | Redirects to `/portal` (plan picker) |
| User has active sub but no claim token minted | TalariaCredentialsPanel | Renders panel; user clicks "Reveal" → mints token via /api/talaria-claim |
| User has active sub, already has a token | TalariaCredentialsPanel | Shows existing token (or forces new mint) |
| Grace period sub | Status check includes `'grace'` | `/welcome` renders, credentials panel shows |
| Expired/cancelled sub | Status check | Redirects to `/portal` (NoSubscriptionCard with Resubscribe) |
| Not signed in | Clerk `<RedirectToSignIn>` / auth check | Redirects to `/sign-in` |

## 5. Files Touched (Summary)

| File | Action | Change |
|---|---|---|
| `app/welcome/page.jsx` | **NEW** | Welcome page with plan-status check + redirect gate + token display |
| `app/payment/success/page.jsx` | **MODIFY** | Link/redirect to `/welcome` on active confirmation |
| `app/portal/page.jsx` | **MODIFY** | Optional `welcome` param check → redirect to `/welcome` if active |
| `app/components/welcome-view.jsx` | **NEW** (or inline) | Reusable welcome content component (optional) |

## 6. Plan-Status Check Detail

The "plan status check" maps directly onto the existing `effectiveStatus` pattern in `app/portal/page.jsx:113`:

```js
const effectiveStatus = sub?.status ?? instantStatus ?? null
```

- `false` (no active sub) → `effectiveStatus` is `null`, `'expired'`, `'cancelled'`, or `'pending'`
  - **Show portal page** (NoSubscriptionCard / pending state)
- `active` (plan status = active) → `effectiveStatus` is `'active'` or `'grace'`
  - **Show the new welcome page** (redirect or inline)

The `/api/subscription-status` endpoint already returns the subscription with status in `["pending", "active", "grace"]` (line 98 of route.js). Any other state (expired, cancelled) means the user does not have an active plan.

## 7. Next Steps (for user confirmation)

1. **[ ] Confirm route name** — `/welcome` vs `/onboarding/complete` vs `/setup`
2. **[ ] Confirm redirect strategy** — auto-redirect from `/payment/success` vs. CTA button
3. **[ ] Confirm portal behavior** — always gate on `welcome=true` param, or also redirect when active users visit `/portal` directly
4. **[ ] Confirm token display** — auto-reveal on welcome page vs. "Reveal" button (security consideration: welcome page is post-purchase, so auto-reveal is acceptable, but keeping the reveal button preserves the existing security UX pattern)

---

*This worklog is a scoping document. No code changes have been made. Awaiting user confirmation on the plan above before building.*

## 7. Implementation (Completed)

### Changes Made

1. **NEW: `app/welcome/page.jsx`** — Server component that:
   - Auths the user via Clerk (`auth()`) — redirects to `/sign-in` if signed out
   - Resolves the local Supabase `users` row (upsert-first-timer pattern)
   - **Plan-status check**: queries `subscriptions` for `status IN (pending, active, grace)`
   - If no active/grace sub → `redirect("/portal")` (the plan picker / onboarding view)
   - If active/grace → renders:
     - Success header with user's display name
     - Subscription summary card (plan name, price, current period, next renewal, grace end)
     - 4-step onboarding checklist (all steps marked complete except "Reveal Talaria credentials")
     - **TalariaCredentialsPanel** with `autoReveal={true}` — auto-mints the claim token on mount
     - **TalariaPluginDownloadPanel** (conditionally, if Precision Pro plan)
     - "What's next?" navigation card with CTAs to portal + Discord

2. **MODIFIED: `app/payment/success/page.jsx`** — On webhook-confirmed `active` status:
   - Changed CTA from "Go to your portal" → "Continue to Talaria setup"
   - Changed link from `/portal` → `/welcome`

3. **MODIFIED: `app/components/talaria-credentials-panel.jsx`** — Added `autoReveal` prop:
   - Accepts `{ autoReveal = false }` — when `true`, initializes revealed state AND auto-mints the claim token on mount via `useEffect`
   - Backward compatible: existing portal usage (no prop) behaves identically

### Verification
- `npm run build` — ✅ passes (0 errors, 0 warnings, `/welcome` route registered as `ƒ /welcome`)
- `npx eslint` on changed files — 0 errors, 3 warnings (all `react-hooks/set-state-in-effect`, consistent with the existing `success/page.jsx:54` pattern already in the repo)
