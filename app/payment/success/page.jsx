"use client";

// =============================================================================
// Noble Trading App — Payment Success Page
// =============================================================================
// Landing page after Helio checkout completes. Because the Helio webhook is
// the source of truth, the DB row may still be `pending` when the user lands
// here. This page:
//   1. Reads /api/subscription-status immediately
//   2. If still `pending`, shows a "Payment received — confirming…" flash and
//      polls every 3s (mirroring the old selectplans forced-refresh cadence)
//      until the webhook flips the row to `active`
//   3. Shows the success state + link to the portal once confirmed
// =============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessContent() {
  const searchParams = useSearchParams();
  const subParam = searchParams.get("sub");

  const [status, setStatus] = useState("checking"); // checking | pending | active | error
  const [planTitle, setPlanTitle] = useState(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/subscription-status");
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      const j = await r.json();
      const s = j?.subscription?.status;
      if (s === "active") {
        setStatus("active");
        setPlanTitle(j.subscription.plans?.title ?? null);
      } else if (s === "pending") {
        setStatus("pending");
        setPlanTitle(j.subscription.plans?.title ?? null);
      } else {
        // expired / cancelled / no sub — treat as error state
        setStatus("error");
      }
    } catch (e) {
      setStatus((prev) => (prev === "checking" ? "error" : prev));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 3s while waiting for webhook confirmation. Stop once the
    // webhook confirms `active`; keep polling on error so a slow webhook can
    // still flip the row (Helio retries up to 12x, so confirmation can land
    // after the initial page load).
    const id = setInterval(() => {
      refresh();
      if (statusRef.current === "active") clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-base-200">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body items-center text-center">
            {/* Spinner / checking */}
            {status === "checking" && (
              <>
                <span className="loading loading-spinner loading-lg text-primary" />
                <h1 className="text-2xl font-bold mt-4">
                  Checking payment status…
                </h1>
                <p className="opacity-60 text-sm">
                  Confirming your payment with our provider.
                </p>
              </>
            )}

            {/* Payment received but webhook hasn't flipped the row yet */}
            {status === "pending" && (
              <>
                <span className="text-5xl">⏳</span>
                <h1 className="text-2xl font-bold mt-4">
                  Payment received — confirming…
                </h1>
                <div className="alert alert-info mt-4">
                  <span>
                    Your payment is being confirmed by our payment provider.
                    Your {planTitle ? `${planTitle} ` : ""}subscription will
                    activate automatically within a minute. This page refreshes
                    automatically — no action needed.
                  </span>
                </div>
                <p className="opacity-50 text-xs mt-3">
                  Still waiting? Your subscription updates as soon as the
                  confirmation arrives.
                </p>
              </>
            )}

            {/* Webhook confirmed — active */}
            {status === "active" && (
              <>
                <span className="text-5xl text-success">✓</span>
                <h1 className="text-2xl font-bold mt-4 text-success">
                  Payment confirmed!
                </h1>
                <p className="opacity-70">
                  {planTitle ? `${planTitle} ` : "Your "}subscription is now
                  active. Welcome aboard! 🎉
                </p>
                <div className="card-actions mt-8">
                  <Link
                    href="/welcome"
                    className="btn btn-primary"
                  >
                    Continue to Talaria setup
                  </Link>
                </div>
              </>
            )}

            {/* Error — no pending/active sub found for this session */}
            {status === "error" && (
              <>
                <span className="text-5xl text-error">!</span>
                <h1 className="text-2xl font-bold mt-4">
                  We couldn&apos;t confirm your payment yet
                </h1>
                <p className="opacity-70 mt-2">
                  It can take a minute for payment confirmations to arrive.
                  Check your portal — your subscription will appear as soon as
                  the provider confirms.
                </p>
                <div className="card-actions mt-8">
                  <Link href="/portal" className="btn btn-primary">
                    Check your portal
                  </Link>
                  <Link href="/" className="btn btn-ghost">
                    Return home
                  </Link>
                </div>
              </>
            )}

            {/* If we have a sub param, show it subtly */}
            {subParam && (
              <p className="opacity-30 text-xs mt-8">
                Reference: {subParam.slice(0, 8)}…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Success() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
