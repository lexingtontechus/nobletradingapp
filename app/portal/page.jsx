// =============================================================================
// Noble Trading App — Enhanced Portal Page
// =============================================================================
// Replaces app/portal/page.jsx. Key upgrades over the old version:
//
//   OLD FLOW                              NEW FLOW
//   ─────────                             ────────
//   Poll Clerk user.reload() every 30s    Single GET /api/subscription-status
//   Read publicMetadata.discord           Read subscriptions table directly
//   Gate plans behind Discord join        Plans visible always; Discord is a
//                                         soft onboarding step (Helio's bot
//                                         assigns the role on payment)
//   No cancel/renew UI                    Cancel + Renew Now + Resubscribe
//   No payment history                    Last 10 payments shown
//   No status badge                       Color-coded badge per status
//   Cosmetic /payment/success             Webhook-driven; portal reflects truth
//
// Onboarding checklist (progressive disclosure):
//   1. Create account ✓ (Clerk)
//   2. Join Discord (optional but recommended — link, not a gate)
//   3. Choose a plan (pricing CTA or inline plan picker)
//   4. Activate (Helio checkout → webhook flips status)
// =============================================================================

"use client"
import { useUser } from "@clerk/nextjs"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { SubscriptionCard } from "../components/subscription-card"
import { SubscriptionStatusBadge } from "../components/subscription-status-badge"
import { TalariaCredentialsPanel } from "../components/talaria-credentials-panel"
import { TalariaPluginDownloadPanel } from "../components/talaria-plugin-download-panel"
import PlanSelector from "../components/plan-selector"

// -----------------------------------------------------------------------------
// HYBRID AUTH PATTERN (see supabase/functions/helio-webhook/index.ts):
// The webhook mirrors subscription state into Clerk publicMetadata:
//   publicMetadata.subscriptionStatus  = 'pending' | 'active' | 'grace' | 'expired' | 'cancelled' | null
//   publicMetadata.plan                = plan title (string) | null
//   publicMetadata.discordId           = Discord user id (string) | null
//   publicMetadata.role                = 'admin' | 'member' (preserved)
//
// These fields ride along in the Clerk JWT, so we can render an INSTANT status
// badge + plan name + admin link on first paint with zero API calls — the
// /api/subscription-status fetch is still done for the detailed view (payment
// history, exact renewal date, etc.) but no longer gates the first paint.
// -----------------------------------------------------------------------------
//type PublicMeta = {
//  subscriptionStatus?: string | null;
//  plan?: string | null;
//  discordId?: string | null;
//  role?: string | null;
//};

export default function Portal() {
  const { isSignedIn, user } = useUser()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // INSTANT first paint — read straight from the Clerk JWT (no API call).
  // Falls back to null while Clerk hydrates; the API fetch below fills in details.
  const pm = user?.publicMetadata ?? {}
  const instantStatus = pm.subscriptionStatus ?? null
  const instantPlan = pm.plan ?? null
  const isAdmin = pm.role === "admin"

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch("/api/subscription-status")
      if (!r.ok) throw new Error(`Failed (${r.status})`)
      const j = await r.json()
      setData(j)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + auto-refresh every 15s (lightweight; one endpoint).
  // Replaces the old 30s user.reload() poll. Future: switch to Supabase
  // Realtime subscriptions on the subscriptions table for true push.
  useEffect(() => {
    if (!isSignedIn) return
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [isSignedIn, refresh])

  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="mb-4">Please sign in to access your portal.</p>
          <Link href="/sign-in" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  // INSTANT FIRST PAINT — show the cached Clerk state immediately while the
  // detailed API fetch is still in flight. This is the hybrid pattern payoff:
  // no spinner flash for returning subscribers.
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-base-200">
        <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
          <div>
            <h1 className="text-3xl font-bold">
              Welcome back,{" "}
              <span className="text-primary">
                {user?.firstName ?? "Trader"}
              </span>
            </h1>
            <p className="opacity-60">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
          {instantStatus && (
            <div className="card bg-base-100 shadow border border-base-300">
              <div className="card-body">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="card-title text-2xl">
                      {instantPlan ?? "Subscription"}
                    </h2>
                    <p className="opacity-60 text-sm">Loading details…</p>
                  </div>
                  <SubscriptionStatusBadge status={instantStatus} />
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm opacity-60">
            <span className="loading loading-spinner loading-sm" /> Fetching
            latest subscription details…
          </div>
        </div>
      </div>
    )
  }

  const sub = data?.subscription
  const payments = data?.payments ?? []
  const events = data?.events ?? []
  // Prefer the fresh API value; fall back to the instant Clerk-cached value.
  const effectiveStatus = sub?.status ?? instantStatus ?? null
  const hasActive = !!sub && ["pending", "active", "grace"].includes(sub.status)
  // Precision Pro gate — for the Talaria plugin download panel
  const planTitle = (sub?.plans?.title ?? instantPlan ?? "").toLowerCase()
  const isPrecisionPro = planTitle.includes("precision")

  return (
    <div className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Welcome back,{" "}
              <span className="text-primary">
                {user?.firstName ?? "Trader"}
              </span>
            </h1>
            <p className="opacity-60">
              {data?.user?.email ?? user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
          {/* INSTANT badge from Clerk JWT — visible even before the API resolves */}
          {effectiveStatus && (!sub || sub.status !== effectiveStatus) && (
            <SubscriptionStatusBadge status={effectiveStatus} />
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className="btn btn-sm btn-outline btn-secondary"
            >
              Admin dashboard
            </Link>
          )}
        </div>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
            <button className="btn btn-sm btn-ghost" onClick={refresh}>
              Retry
            </button>
          </div>
        )}

        {/* Onboarding checklist (progressive) */}
        <OnboardingChecklist
          accountCreated
          hasSubscription={!!hasActive || instantStatus === "active"}
          subscriptionActive={
            sub?.status === "active" || instantStatus === "active"
          }
        />

        {/* Current subscription (if any) */}
        {hasActive ? (
          <SubscriptionCard subscription={sub} onStatusChange={refresh} />
        ) : instantStatus === "active" ? (
          // Edge case: Clerk says active but the API fetch hasn't resolved yet —
          // show a minimal card so the user doesn't see "no subscription" flash.
          <div className="card bg-base-100 shadow border border-base-300">
            <div className="card-body">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="card-title text-2xl">
                    {instantPlan ?? "Your subscription"}
                  </h2>
                  <p className="opacity-60 text-sm">Loading details…</p>
                </div>
                <SubscriptionStatusBadge status="active" />
              </div>
            </div>
          </div>
        ) : (
          <NoSubscriptionCard onChosePlan={refresh} />
        )}

        {/* Talaria credentials panel — shown only for active/grace subs.
            Hidden behind a "Reveal" button so creds aren't visible on screen-share. */}
        {sub && (sub.status === "active" || sub.status === "grace") && (
          <>
            <TalariaCredentialsPanel />
            {/* Precision Pro only — plugin download link */}
            {isPrecisionPro && <TalariaPluginDownloadPanel />}
          </>
        )}
        {sub && (sub.status === "expired" || sub.status === "cancelled") && (
          <div className="alert alert-warning">
            <span>
              Your Talaria access token has been revoked. Resubscribe to regain
              access to the signal stream.
            </span>
          </div>
        )}

        {/* Recent activity timeline (events) */}
        {events.length > 0 && (
          <div className="card bg-base-100 shadow border border-base-300">
            <div className="card-body">
              <h3 className="card-title text-lg">Recent activity</h3>
              <ul className="timeline timeline-vertical">
                {events.map((ev, i) => (
                  <li key={i}>
                    <div className="timeline-start text-xs opacity-60">
                      {new Date(ev.received_at).toLocaleString()}
                    </div>
                    <div className="timeline-middle">
                      <span className="badge badge-sm badge-primary">
                        {ev.event_type}
                      </span>
                    </div>
                    <div className="timeline-end text-sm">
                      {ev.amount_cents
                        ? `$${(ev.amount_cents / 100).toFixed(2)} ${
                            ev.currency
                          }`
                        : "—"}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Payment history */}
        {payments.length > 0 && (
          <div className="card bg-base-100 shadow border border-base-300">
            <div className="card-body">
              <h3 className="card-title text-lg">Payment history</h3>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map(p => (
                      <tr key={p.id}>
                        <td>{new Date(p.paid_at).toLocaleDateString()}</td>
                        <td>
                          ${(p.amount_cents / 100).toFixed(2)} {p.token_symbol}
                        </td>
                        <td>
                          <span className="badge badge-sm">
                            {p.is_renewal ? "Renewal" : "Initial"}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-sm badge-success">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Onboarding checklist — progressive disclosure of next steps
// Discord is NOT a step: MoonPay/Helio auto-joins the Discord server and
// assigns the role at checkout (the webhook writes users.discord_id), so the
// checklist reflects that Discord access arrives with an active subscription.
// -----------------------------------------------------------------------------
function OnboardingChecklist({
  accountCreated,
  hasSubscription,
  subscriptionActive
}) {
  const steps = [
    { label: "Create account", done: accountCreated },
    { label: "Choose a plan", done: hasSubscription },
    { label: "Activate subscription", done: subscriptionActive },
    { label: "Discord access (auto)", done: subscriptionActive }
  ]
  const doneCount = steps.filter(s => s.done).length

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h3 className="card-title text-lg">Getting started</h3>
          <span className="text-sm opacity-60">
            {doneCount}/{steps.length} complete
          </span>
        </div>
        <progress
          className="progress progress-primary w-full"
          value={doneCount}
          max={steps.length}
        />
        <ul className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              {s.done ? (
                <span className="text-success text-lg">✓</span>
              ) : (
                <span className="text-base-300 text-lg">○</span>
              )}
              <span className={s.done ? "line-through opacity-50" : ""}>
                {s.label}
              </span>
              {!s.done && s.label === "Choose a plan" && (
                <Link
                  href="/pricing"
                  className="btn btn-xs btn-outline ml-auto"
                >
                  View plans
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// No active subscription — inline plan picker (Helio checkout)
// -----------------------------------------------------------------------------
function NoSubscriptionCard({ onChosePlan }) {
  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body">
        <h2 className="card-title text-2xl">Choose a plan</h2>
        <p className="opacity-70 text-sm">
          Pick a plan to unlock trade signals and Discord community access.
          You'll be asked to connect your Discord account at checkout —
          MoonPay handles the join automatically.
        </p>
        <div className="mt-4">
          <PlanSelector />
        </div>
      </div>
    </div>
  )
}
