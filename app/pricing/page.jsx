// =============================================================================
// Noble Trading App — Public Pricing Page
// =============================================================================
// DECOUPLES pricing from the Discord gate. Anyone can see plans; signup is
// the call-to-action. This replaces the old pattern where plans were hidden
// inside /portal behind `publicMetadata.discord === "true"`.
//
// Enhancement rationale:
//   - Pricing is a top-of-funnel concern; gating it behind auth + Discord
//     join kills conversion. Show it publicly, then convert.
//   - The Helio checkout itself captures Discord identity (if the paylink
//     requires Discord login), so the manual join-Discord-first step is
//     redundant — Helio's managed bot assigns the role on payment.
//
// Marketing polish (kept data-driven):
//   - Plan-aware feature checklists sourced from docs/marketing/*.md
//     (signal-scout.md / precision-pro.md / talaria-plugin.md), keyed by
//     plan title so the DB stays the single source of truth for plans.
//   - Headings, badges, and shared-features strip added for conversion;
//     the Supabase fetch, isPopular badge, and CheckoutButton wiring are
//     unchanged.
// =============================================================================

import { createClient } from "@supabase/supabase-js"
import { Show, SignInButton } from "@clerk/nextjs"
import Link from "next/link"
import CheckoutButton from "../components/checkout"

// Server-side read of plans (anon key is fine — RLS allows public reads of
// active plans; see the "plans public read" policy in 0001_init.sql).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY,
  { auth: { persistSession: false } }
)

// Plan-aware marketing copy, sourced from docs/marketing/*.md. Keyed by a
// substring of the DB plan title so new plans still render with a sane
// generic fallback instead of a hardcoded list.
const PLAN_COPY = {
  scout: {
    badge: "The on-ramp",
    tagline:
      "A focused watchlist of ten markets — quality-gated signals, the full Talaria dashboard, and the reasoning behind every call.",
    features: [
      "Ten curated symbols — a watchlist you can actually watch",
      "Quality-gated signals with entry, stop & take-profit on every call",
      "Live Renko brick charts in the Talaria dashboard",
      "Market-regime labels on every signal",
      "30-day signal health scoreboard — win rate, bias & profit factor",
      "Signal science: Markov probability, brick-pattern & sizing what-if",
      "Real-time signal push — hot banner, dockable widget & toasts",
      "Noble Trading Discord community access",
    ],
  },
  pro: {
    badge: "The full seat",
    tagline:
      "The Talaria trading agent, twenty curated symbols, live alerts and the analytics to verify the edge.",
    features: [
      "Everything in Signal Scout, plus:",
      "Twenty curated symbols — double the Scout watchlist",
      "The Talaria trading agent watching markets around the clock",
      "Paper portfolio: daily equity curve, realized PnL & R-multiple",
      "Portfolio analytics — Sharpe, Sortino, Calmar, drawdown & more",
      "Paper vs. equal-weight benchmark — proof, not promises",
      "Live alerts with the full advanced analytics dashboard",
    ],
  },
}

// Fallback used if a future plan title matches neither tier.
const GENERIC_COPY = {
  badge: null,
  tagline:
    "Everything you need to follow a professional signal feed, delivered inside the Talaria dashboard.",
  features: [
    "Qualified signals with entry, stop & take-profit levels",
    "Live Renko brick charts in the Talaria dashboard",
    "Market-regime labels on every signal",
    "Real-time signal push — dockable widget & toasts",
    "Noble Trading Discord community access",
  ],
}

// Features shared by every plan (docs/marketing/talaria-plugin.md).
const SHARED_FEATURES = [
  "The Talaria plugin, docked inside the Hermes desktop app",
  "Renko brick charts with full entry / stop-loss / take-profit levels",
  "Market-regime labels — bull, bear or volatility — on every signal",
  "Real-time signal push with automatic polling fallback",
  "30-day signal health scoreboard per symbol",
  "Daily digest of signal and performance highlights",
  "Noble Trading Discord community access",
]

function copyForTitle(title) {
  const t = (title || "").toLowerCase()
  if (t.includes("precision")) return PLAN_COPY.pro
  if (t.includes("scout")) return PLAN_COPY.scout
  return GENERIC_COPY
}

export default async function PricingPage() {
  const { data: plans } = await supabase
    .from("plans")
    .select(
      "id, title, description, price_cents, currency, interval, sort_order"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true })

  return (
    <main className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="text-center mb-12">
          <span className="badge badge-primary badge-outline mb-4">
            Signal Scout · Precision Pro
          </span>
          <h1 className="text-4xl font-bold tracking-tight">
            Choose your plan
          </h1>
          <p className="mt-3 text-lg opacity-70 max-w-2xl mx-auto">
            Professional signal feed, delivered inside the Talaria dashboard —
            quality-gated signals with the reasoning behind every call. Crypto
            subscriptions powered by MoonPay Commerce. Cancel anytime.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {plans?.map(plan => {
            const isPopular = plan.title.toLowerCase().includes("precision")
            const copy = copyForTitle(plan.title)
            return (
              <div
                key={plan.id}
                className={`card bg-base-100 shadow-xl ${
                  isPopular ? "border-2 border-primary" : ""
                }`}
              >
                <div className="card-body">
                  <div className="flex items-center justify-between gap-2">
                    {isPopular ? (
                      <span className="badge badge-primary badge-lg">
                        ★ Most Popular
                      </span>
                    ) : (
                      <span className="badge badge-primary badge-outline">
                        {copy.badge}
                      </span>
                    )}
                    <span className="badge badge-ghost badge-sm opacity-70">
                      Talaria plugin included
                    </span>
                  </div>
                  <h2 className="card-title text-2xl mt-2">{plan.title}</h2>
                  <p className="opacity-70 min-h-12">{plan.description}</p>
                  <p className="text-sm font-medium text-primary mt-1">
                    {copy.tagline}
                  </p>
                  <div className="my-4">
                    <span className="text-4xl font-bold">
                      ${(plan.price_cents / 100).toFixed(0)}
                    </span>
                    <span className="opacity-60">
                      /{plan.interval.toLowerCase()}
                    </span>
                    <p className="text-xs opacity-50 mt-1">
                      Billed monthly in USDC · cancel anytime
                    </p>
                  </div>
                  <ul className="space-y-2 text-sm opacity-80">
                    {copy.features.map(feature => {
                      const isSectionHead = feature.endsWith("plus:")
                      return isSectionHead ? (
                        <li
                          key={feature}
                          className="pt-2 font-semibold opacity-90"
                        >
                          {feature}
                        </li>
                      ) : (
                        <li key={feature} className="flex items-start gap-2">
                          <span className="text-primary">✓</span>
                          <span>{feature}</span>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="card-actions mt-6">
                    <Show when="signed-in">
                      <div className="w-full flex flex-col gap-2">
                        <CheckoutButton plan={plan} />
                        <Link
                          href="/portal"
                          className="btn btn-ghost btn-sm w-full"
                        >
                          Manage in Portal
                        </Link>
                      </div>
                    </Show>
                    <Show when="signed-out">
                      <SignInButton mode="modal">
                        <button className="btn btn-primary w-full">
                          Sign up to subscribe
                        </button>
                      </SignInButton>
                    </Show>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="card bg-base-100 shadow-md mt-10">
          <div className="card-body">
            <h3 className="card-title text-lg justify-center">
              What&apos;s included in both plans
            </h3>
            <ul className="grid gap-x-8 gap-y-2 text-sm opacity-80 sm:grid-cols-2">
              {SHARED_FEATURES.map(feature => (
                <li key={feature} className="flex items-start gap-2">
                  <span className="text-primary">✓</span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-center mt-12 text-sm opacity-50">
          Payments processed securely by MoonPay Commerce (Hel.io).
          Subscriptions renew monthly — you&apos;ll get an email reminder before
          each renewal.
        </p>
      </div>
    </main>
  )
}
