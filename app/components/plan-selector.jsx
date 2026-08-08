// =============================================================================
// Noble Trading App — Plan Selector (checkout)
// =============================================================================
// Client component that loads active plans from GET /api/plans (single source
// of truth = the `plans` table) and renders each with the generic
// CheckoutButton, which:
//   1. POSTs /api/create-subscription → mints a `pending` subscriptions row
//   2. Returns { subscriptionId, paylinkId } (paylink from the plans table)
//   3. Renders <HelioCheckout> with additionalJSON.subscription_id so the
//      Helio webhook can correlate the payment back to the row and update
//      Supabase users (discord_id/username) + Clerk metadata.
//
// Replaces the old plan pickers that hardcoded paylink ids per plan and did
// NOT pass additionalJSON (which broke webhook correlation → users row was
// never updated with discord identity).
// =============================================================================

"use client"

import { useEffect, useState } from "react"
import CheckoutButton from "./checkout"

export default function PlanSelector({ compact = false }) {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("/api/plans")
        if (!r.ok) throw new Error(`Failed (${r.status})`)
        const j = await r.json()
        if (!cancelled) setPlans(j ?? [])
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm opacity-60 py-4">
        <span className="loading loading-spinner loading-sm" /> Loading plans…
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error py-3">
        <span>Could not load plans: {error}</span>
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="alert alert-warning py-3">
        <span>No plans are currently available.</span>
      </div>
    )
  }

  return (
    <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2"}>
      {plans.map(plan => {
        const isPopular = plan.title.toLowerCase().includes("precision")
        return (
          <div
            key={plan.id}
            className={`card bg-base-100 shadow border ${
              isPopular ? "border-primary" : "border-base-300"
            }`}
          >
            <div className="card-body">
              {isPopular && (
                <span className="badge badge-primary badge-outline self-start">
                  Most Popular
                </span>
              )}
              <h3 className="card-title">{plan.title}</h3>
              <p className="text-sm opacity-70 min-h-10">{plan.description}</p>
              <div className="my-2">
                <span className="text-3xl font-bold">
                  ${(plan.price_cents / 100).toFixed(0)}
                </span>
                <span className="opacity-60">/{plan.interval?.toLowerCase()}</span>
              </div>
              <ul className="text-sm opacity-80 space-y-1 mb-3">
                <li>✓ Discord community access (auto-joined)</li>
                <li>✓ Daily trade signals</li>
                <li>✓ Real-time alerts</li>
                {isPopular && <li>✓ Advanced analytics dashboard</li>}
              </ul>
              <div className="card-actions mt-2">
                <CheckoutButton plan={plan} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
