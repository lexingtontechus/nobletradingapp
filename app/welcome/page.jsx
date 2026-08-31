// =============================================================================
// Noble Trading App — Welcome Page (post-payment)
// =============================================================================
// Server component that runs a plan-status check on the authenticated user:
//   - No active/grace subscription → redirect("/portal")
//   - Active/grace subscription      → render the welcome view with Talaria
//                                      credentials + plugin download
//
// Why a server component? The plan-status check needs the Supabase service
// role key (to bypass RLS and read the user's subscription row), which must
// stay server-side. The redirect happens before any client JS ships to the
// browser, so there's no flash of wrong content.
// =============================================================================

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { TalariaCredentialsPanel } from "@/app/components/talaria-credentials-panel";
import { TalariaPluginDownloadPanel } from "@/app/components/talaria-plugin-download-panel";
import { SubscriptionStatusBadge } from "@/app/components/subscription-status-badge";

// Service-role client (server-only). Bypasses RLS.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function WelcomePage() {
  // 1. Auth — must be signed in
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  // 2. Resolve the local user row (same upsert-first-timer pattern as
  //    /api/subscription-status — keeps the user table in sync)
  let { data: localUser } = await supabase
    .from("users")
    .select("id, email, discord_username, role")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!localUser) {
    // First-time visitor — fall through to portal (which also upserts).
    redirect("/portal");
  }

  // 3. Plan-status check: most recent active/grace/pending subscription.
  let { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      `
      id, status, current_period_start, current_period_end, grace_period_end,
      helio_renewal_date, cancelled_at, created_at,
      plans(id, title, description, price_cents, currency, interval, slug, helio_paylink_id)
    `
    )
    .eq("user_id", localUser.id)
    .in("status", ["pending", "active", "grace"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4. Gate: only active/grace subscribers see the welcome view.
  //    pending, expired, cancelled, or no-sub → redirect to portal.
  const isActive =
    subscription &&
    (subscription.status === "active" || subscription.status === "grace");

  if (!isActive) {
    redirect("/portal");
  }

  const plan = subscription.plans;
  //const isPrecisionPro = (plan.title ?? "").toLowerCase().includes("precision");
  const displayName =
    localUser.discord_username ?? localUser.email ?? "Trader";

  return (
    <div className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-4xl px-4 py-16 space-y-8">
        {/* Success header */}
        <div className="text-center">
          <span className="text-6xl">🎉</span>
          <h1 className="text-4xl font-bold mt-4">
            Welcome to Talaria By Noble Trading App,{" "}
            <span className="text-primary lowercase">{displayName.split(" ")[0]}</span>!
          </h1>
          <p className="opacity-70 mt-2">
            Your {plan.title} subscription is now active. Here's everything you
            need to get started with Talaria.
          </p>
        </div>

        {/* Subscription summary card */}
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="card-title text-2xl">{plan.title}</h2>
                <p className="opacity-60 text-sm">
                  ${(plan.price_cents / 100).toFixed(0)}/
                  {plan.interval.toLowerCase()} · {plan.currency}
                </p>
              </div>
              <SubscriptionStatusBadge status={subscription.status} />
            </div>

            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="opacity-60">Current period</span>
                <span>
                  {formatDate(subscription.current_period_start)} →{" "}
                  {formatDate(subscription.current_period_end)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Next renewal</span>
                <span className="font-semibold">
                  {formatDate(subscription.helio_renewal_date)}
                </span>
              </div>
              {subscription.grace_period_end && (
                <div className="flex justify-between">
                  <span className="opacity-60">Grace period ends</span>
                  <span className="text-warning">
                    {formatDate(subscription.grace_period_end)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Onboarding checklist — all steps */}
        <div className="card bg-base-100 shadow border border-base-300">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <h3 className="card-title text-lg">Onboarding walkthrough</h3>
              <span className="text-sm opacity-60">4/4 complete</span>
            </div>
            <progress
              className="progress progress-primary w-full"
              value={4}
              max={4}
            />
            <ul className="mt-2 space-y-2">
              <li className="flex items-center gap-3 text-sm">
                <span className="text-success text-lg">✓</span>
                <span className="line-through opacity-50">Create account</span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                <span className="text-success text-lg">✓</span>
                <span className="line-through opacity-50">
                  Subscribe to {plan.title}
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                <span className="text-success text-lg">✓</span>
                <span className="line-through opacity-50">
                  Activate subscription
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                <span className="text-warning text-lg">○</span>
                <span>Reveal Talaria credentials &amp; install plugin</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Credentials panel — auto-revealed on welcome page since payment just
            confirmed. The panel itself still requires a click to mint the token
            (security: the token is only generated on demand). */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Talaria client credentials</h3>
          <p className="text-sm opacity-60 mb-3">
            Reveal your claim token to connect the Talaria plugin inside the
            Hermes desktop app. This token proves your identity; the live
            subscription row grants access.
          </p>
          <TalariaCredentialsPanel autoReveal={false} />

        </div>

        {/* Precision Pro plugin download */}
        <TalariaPluginDownloadPanel />

        {/* Next steps / navigation */}
        <div className="card bg-base-100 shadow border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-lg">What's next?</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="text-primary">1.</span>
                <span>
                  <strong>Open the Hermes desktop app.</strong> The Talaria
                  plugin is built in — no separate download needed for Signal
                  Scout. Paste your claim token into the plugin's Connect tab.
                </span>
              </li>

                <li className="flex items-start gap-3">
                  <span className="text-primary">2.</span>
                  <span>
                    <strong>Download the Talaria plugin</strong> for Precision
                    Pro advanced analytics (paper portfolio, Sharpe/Sortino
                    tear-sheet). The link is above.
                  </span>
                </li>

              <li className="flex items-start gap-3">
                <span className="text-primary">3.</span>
                <span>
                  <strong>Bookmark your portal.</strong> Return anytime to
                  manage billing, cancel, or view payment history.
                </span>
              </li>
            </ul>
            <div className="card-actions mt-6">
              <Link href="/portal" className="btn btn-primary">
                Go to portal
              </Link>
              {process.env.NEXT_PUBLIC_DISCORD_URL && (
                <a
                  href={process.env.NEXT_PUBLIC_DISCORD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-outline"
                >
                  Join Discord
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
