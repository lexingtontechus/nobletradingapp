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
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import Link from "next/link";

// Server-side read of plans (anon key is fine — RLS allows public reads of
// active plans; see the "plans public read" policy in 0001_init.sql).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY!,
  { auth: { persistSession: false } },
);

export default async function PricingPage() {
  const { data: plans } = await supabase
    .from("plans")
    .select("id, title, description, price_cents, currency, interval, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <main className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight">Membership Plans</h1>
          <p className="mt-3 text-lg opacity-70">
            Crypto subscriptions powered by MoonPay Commerce. Cancel anytime.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {plans?.map((plan: any) => {
            const isPopular = plan.title.toLowerCase().includes("precision");
            return (
              <div
                key={plan.id}
                className={`card bg-base-100 shadow-xl ${isPopular ? "border-2 border-primary" : ""}`}
              >
                <div className="card-body">
                  {isPopular && (
                    <span className="badge badge-primary badge-outline self-start">
                      Most Popular
                    </span>
                  )}
                  <h2 className="card-title text-2xl">{plan.title}</h2>
                  <p className="opacity-70 min-h-[3rem]">{plan.description}</p>
                  <div className="my-4">
                    <span className="text-4xl font-bold">
                      ${(plan.price_cents / 100).toFixed(0)}
                    </span>
                    <span className="opacity-60">/{plan.interval.toLowerCase()}</span>
                  </div>
                  <ul className="space-y-2 text-sm opacity-80">
                    <li>✓ Discord community access</li>
                    <li>✓ Daily trade signals</li>
                    <li>✓ Real-time alerts</li>
                    {isPopular && <li>✓ Advanced analytics dashboard</li>}
                  </ul>
                  <div className="card-actions mt-6">
                    <SignedIn>
                      <Link
                        href="/portal"
                        className="btn btn-primary w-full"
                      >
                        Manage in Portal
                      </Link>
                    </SignedIn>
                    <SignedOut>
                      <SignInButton mode="modal">
                        <button className="btn btn-primary w-full">
                          Sign up to subscribe
                        </button>
                      </SignInButton>
                    </SignedOut>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-center mt-12 text-sm opacity-50">
          Payments processed securely by MoonPay Commerce (Hel.io).
          Subscriptions renew monthly — you'll get an email reminder before each renewal.
        </p>
      </div>
    </main>
  );
}
