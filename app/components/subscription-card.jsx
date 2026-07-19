// =============================================================================
// Noble Trading App — Subscription Card Component
// =============================================================================
// Renders the user's current subscription with a status badge, renewal date,
// and contextual actions:
//   - active  → shows next renewal date + "Cancel" button
//   - grace   → shows red banner + "Renew Now" button (mints a charge on demand)
//   - pending → shows "Complete your payment" (re-renders the Helio checkout)
//   - expired → shows "Resubscribe" (mints a new pending row + checkout)
//
// Replaces the old activeuser.jsx + selectplans.jsx split logic.
// =============================================================================

"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { HelioCheckout } from "@heliofi/checkout-react";
import { SubscriptionStatusBadge } from "./subscription-status-badge";

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function SubscriptionCard({ subscription, onStatusChange }: {
  subscription: any;
  onStatusChange?: () => void;
}) {
  const { user } = useUser();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!subscription) return null;
  const plan = subscription.plans;
  const status = subscription.status as "pending" | "active" | "grace" | "expired" | "cancelled";

  async function handleCancel() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subscription.id, reason: cancelReason }),
      });
      if (!r.ok) {
        const b = await r.json();
        throw new Error(b.error || "Cancel failed");
      }
      setCancelOpen(false);
      onStatusChange?.();
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function handleRenewNow() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/create-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subscription.id }),
      });
      if (!r.ok) {
        const b = await r.json();
        throw new Error(b.error || "Renew failed");
      }
      const { chargeUrl } = await r.json();
      // Open the Helio charge page in a new tab (deep-link, optimal for mobile)
      window.open(chargeUrl, "_blank");
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="card bg-base-100 shadow-xl border border-base-300">
      <div className="card-body">
        {/* Header: plan title + status badge */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="card-title text-2xl">{plan?.title ?? "Subscription"}</h2>
            <p className="opacity-60 text-sm">
              ${(plan?.price_cents / 100).toFixed(0)}/{plan?.interval?.toLowerCase()} · {plan?.currency}
            </p>
          </div>
          <SubscriptionStatusBadge status={status} />
        </div>

        {/* Body: contextual by status */}
        <div className="mt-4 space-y-2 text-sm">
          {status === "pending" && (
            <div className="alert alert-warning">
              <span>Complete your payment to activate your subscription.</span>
            </div>
          )}

          {status === "active" && (
            <>
              <div className="flex justify-between">
                <span className="opacity-60">Current period</span>
                <span>
                  {formatDate(subscription.current_period_start)} → {formatDate(subscription.current_period_end)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Next renewal</span>
                <span className="font-semibold">{formatDate(subscription.current_period_end)}</span>
              </div>
              <div className="opacity-60 text-xs pt-1">
                You'll get an email reminder before your renewal date. Renew with a single wallet tap.
              </div>
            </>
          )}

          {status === "grace" && (
            <>
              <div className="alert alert-error">
                <div>
                  <div className="font-semibold">Your subscription has lapsed into grace</div>
                  <div className="text-xs">
                    Renew by {formatDate(subscription.grace_period_end)} to keep your Discord access.
                  </div>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="opacity-60">Grace ends</span>
                <span className="font-semibold text-error">{formatDate(subscription.grace_period_end)}</span>
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="card-actions mt-4 flex-wrap gap-2">
          {status === "active" && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setCancelOpen(true)}
              disabled={busy}
            >
              Cancel subscription
            </button>
          )}
          {status === "grace" && (
            <button
              className="btn btn-primary"
              onClick={handleRenewNow}
              disabled={busy}
            >
              {busy ? "Preparing renewal…" : "Renew Now"}
            </button>
          )}
          {status === "pending" && (
            <HelioCheckout
              config={{
                paylinkId: subscription.helio_paylink_id,
                display: "button",
                network: process.env.NEXT_PUBLIC_HELIO_NETWORK || "test",
                primaryColor: "#5865f2",
                theme: { themeMode: "dark" },
                customTexts: { mainButtonTitle: ` Complete payment ` },
                additionalJSON: {
                  subscription_id: subscription.id,
                  user_id: user?.id,
                },
                onSuccess: () => onStatusChange?.(),
                onError: (e: any) => console.error(e),
                onPending: (e: any) => console.log(e),
                onCancel: () => {},
                onStartPayment: () => {},
              }}
            />
          )}
        </div>

        {error && <p className="text-sm text-error mt-2">{error}</p>}

        {/* Cancel modal */}
        {cancelOpen && (
          <div className="modal modal-open">
            <div className="modal-box">
              <h3 className="font-bold text-lg">Cancel subscription?</h3>
              <p className="py-4 text-sm opacity-70">
                Your subscription stays active until {formatDate(subscription.current_period_end)}.
                After that, it won't renew. Your Discord role will be removed.
              </p>
              <textarea
                className="textarea textarea-bordered w-full"
                placeholder="Reason (optional)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <div className="modal-action">
                <button className="btn btn-ghost" onClick={() => setCancelOpen(false)} disabled={busy}>
                  Keep subscription
                </button>
                <button className="btn btn-error" onClick={handleCancel} disabled={busy}>
                  {busy ? "Cancelling…" : "Confirm cancel"}
                </button>
              </div>
            </div>
            <div className="modal-backdrop" onClick={() => setCancelOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
