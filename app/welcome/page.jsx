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
import { TalariaSignalCopyPanel } from "@/app/components/talaria-signal-copy-panel";
import { SubscriptionStatusBadge } from "@/app/components/subscription-status-badge";

// Service-role client (server-only). Bypasses RLS.
// Lazy singleton: createClient throws at module load when env is absent, which
// takes down the build at import time. Absent config becomes a null client the
// page turns into a redirect instead.
let _client = null;
function getClient() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return null;
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}

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

  const supabase = getClient();
  if (!supabase) {
    redirect("/portal");
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

  // ADMIN IS THE TOP OF THE GATE — full access regardless of subscription
  // state. This page renders the plan title/price off the subscription row, so
  // an admin with no current sub has nothing to onboard from here: send them to
  // the dashboard instead of bouncing them to the plan picker (a paying-
  // customer surface). Without this, any admin landing here is redirected to
  // /portal — the exact symptom of the edge-lab bounce.
  if (localUser.role === "admin") {
    if (!isActive) redirect("/dashboard");
  } else if (!isActive) {
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

        {/* Talaria Signal Copy — Python bridge / local EA (claim token included) */}
        <TalariaSignalCopyPanel />

        {/* Next steps / navigation */}
        <div className="card bg-base-100 shadow border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-lg">What's next?</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="text-primary">1.</span>
                <span>
                  <strong>Install Talaria Signal Copy</strong> on the same computer as
                  MetaTrader 5 (Windows or macOS). Put the Python files in a folder
                  such as <code className="font-mono text-xs">C:\Talaria\</code> or{" "}
                  <code className="font-mono text-xs">~/Talaria/</code> and run the
                  program.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary">2.</span>
                <span>
                  <strong>Reveal your claim token</strong> and save{" "}
                  <code className="font-mono text-xs">otc_token.txt</code> in that
                  same folder.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-primary">3.</span>
                <span>
                  <strong>Talaria realtime signals</strong> reach you automatically
                  while MetaTrader&nbsp;5 is open. Optional: add{" "}
                  <code className="font-mono text-xs">TalariaCopy.mq5</code> in{" "}
                  <code className="font-mono text-xs">MQL5\Experts\</code> if you want
                  BUY / SELL buttons on the chart to confirm each trade.
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
