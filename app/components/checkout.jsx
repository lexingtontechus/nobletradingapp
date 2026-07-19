// =============================================================================
// Noble Trading App — Generic Helio Checkout Component
// =============================================================================
// Replaces the old checkoutsignalscout.jsx + checkoutprecisionpro.jsx with a
// single data-driven component. The parent (selectplans.jsx) calls
// /api/create-subscription to mint a pending row, then renders this with the
// returned subscriptionId + paylinkId.
//
// Key change vs. old code:
//   - additionalJSON.subscription_id is passed to Helio so webhooks can
//     correlate the payment back to our subscriptions row.
//   - onSuccess only updates UI; the webhook is the source of truth.
// =============================================================================

"use client";

import { useState } from "react";
import { HelioCheckout } from "@heliofi/checkout-react";
import { useUser } from "@clerk/nextjs";

export default function CheckoutButton({ plan }) {
  const { user } = useUser();
  const [subscriptionId, setSubscriptionId] = useState(null);
  const [paylinkId, setPaylinkId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleInitiate() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      if (!resp.ok) {
        const body = await resp.json();
        throw new Error(body.error || "Failed to start checkout");
      }
      const { subscriptionId, paylinkId } = await resp.json();
      setSubscriptionId(subscriptionId);
      setPaylinkId(paylinkId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Not yet initiated → show the "Subscribe" button that mints the pending row
  if (!subscriptionId) {
    return (
      <div className="flex flex-col gap-2">
        <button
          onClick={handleInitiate}
          disabled={loading}
          className="rounded-lg bg-[#5865f2] px-6 py-3 font-semibold text-white hover:bg-[#4752c4] disabled:opacity-50"
        >
          {loading ? "Starting…" : `Subscribe to ${plan.title}`}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  // Pending row created → render the Helio checkout widget with additionalJSON
  const helioConfig = {
    paylinkId,
    display: "button",
    network: process.env.HELIO_NETWORK || "test",
    primaryColor: "#5865f2",
    neutralColor: "#e0e3ff",
    textColor: "#242424",
    theme: { themeMode: "dark" },
    customTexts: { mainButtonTitle: ` Pay for ${plan.title} ` },
    // CRITICAL: this round-trips into the Helio webhook payload, letting the
    // Supabase Edge Function update the correct subscriptions row.
    additionalJSON: {
      subscription_id: subscriptionId,
      user_id: user?.id,
      plan_id: plan.id,
      email: user?.emailAddresses[0]?.emailAddress,
    },
    // UI feedback only — the webhook is authoritative.
    onSuccess: (event) => {
      console.log("Helio onSuccess", event);
      // Optimistic: tell the user it's processing. The webhook will flip
      // the sub to `active` within seconds; the portal polls/reloads.
      window.location.href = "/payment/success?sub=" + subscriptionId;
    },
    onError: (event) => console.error("Helio onError", event),
    onPending: (event) => console.log("Helio onPending", event),
    onCancel: () => console.log("Helio onCancel"),
    onStartPayment: () => console.log("Helio onStartPayment"),
  };

  return (
    <div className="max-w-40">
      <HelioCheckout config={helioConfig} className="border-0 max-w-40" />
    </div>
  );
}
