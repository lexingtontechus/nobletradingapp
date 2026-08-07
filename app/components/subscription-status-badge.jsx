// =============================================================================
// Subscription status badge — color-coded pill for each status
// =============================================================================

export function SubscriptionStatusBadge({ status }) {
  const map = {
    pending: { cls: "badge-warning", label: "Pending" },
    active: { cls: "badge-success", label: "Active" },
    grace: { cls: "badge-error badge-outline", label: "Grace" },
    expired: { cls: "badge-ghost", label: "Expired" },
    cancelled: { cls: "badge-ghost", label: "Cancelled" }
  }
  const m = map[status] ?? { cls: "badge-ghost", label: status }
  return <span className={`badge ${m.cls}`}>{m.label}</span>
}
