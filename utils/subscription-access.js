// =============================================================================
// Noble Trading App — shared subscription gate
// =============================================================================
// The ONE place that decides "does this user have access". Every server route
// and page that gates on a subscription must go through here, so the rules
// cannot drift between the portal, the dashboard, and the edge-lab page.
//
// Two rules, in order:
//
//   1. role === "admin"  →  FULL ACCESS, regardless of subscription state.
//      Admin is the top of the gate, not a plan tier.
//
//   2. otherwise the subscription must be CURRENT: status ∈ {active, grace}
//      AND the period has not lapsed (grace_period_end, else current_period_end).
//
// WHY THE DATE CHECK: `subscriptions.status` is driven ONLY by Helio webhooks
// (see README "Grace period expires unpaid → Helio fires ENDED →
// status='expired'"). A missed webhook leaves a lapsed row reading as `active`
// forever — observed: 3 of 3 `active` rows in the table were already past
// their period end. Status alone is therefore not trustworthy.
//
// Migration 0033's `expire_lapsed_subscriptions()` cron repairs the data;
// these functions are the guard that stops a missed run from silently
// re-granting access to a lapsed subscriber.
// =============================================================================

/** Statuses that represent a live (non-terminal) subscription row. */
const LIVE_STATUSES = ["active", "grace"];

/** Statuses the portal treats as "has something" (payment still confirming). */
const PORTAL_STATUSES = ["pending", "active", "grace"];

/**
 * Paid access: status is active/grace AND the period has not lapsed.
 * A row with no dates at all falls back to trusting its status.
 */
export function isCurrentSubscription(sub) {
  if (!sub) return false;
  if (!LIVE_STATUSES.includes(sub.status)) return false;
  const end = sub.grace_period_end ?? sub.current_period_end;
  if (!end) return true;
  return new Date(end).getTime() >= Date.now();
}

/**
 * Subscriber gate (edge-lab, portal card): a pending payment still counts —
 * the user has checked out and the webhook is in flight.
 */
export function hasSubscriberAccess(sub) {
  if (!sub) return false;
  if (sub.status === "pending") return true;
  return isCurrentSubscription(sub);
}

/**
 * Full access. Admin beats subscription state entirely; everyone else needs a
 * current subscription.
 */
export function hasFullAccess({ role, subscription }) {
  if (role === "admin") return true;
  return isCurrentSubscription(subscription);
}

/** Portal view: pending shows the "confirming" state rather than the picker. */
export function hasPortalAccess(sub) {
  if (!sub) return false;
  if (!PORTAL_STATUSES.includes(sub.status)) return false;
  return sub.status === "pending" || isCurrentSubscription(sub);
}
