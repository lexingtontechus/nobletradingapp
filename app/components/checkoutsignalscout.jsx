// =============================================================================
// DEPRECATED — 2026-08-09. DO NOT USE for new code.
// =============================================================================
// Superseded by the generic, data-driven `./checkout.jsx` (CheckoutButton),
// which:
//   - mints the `pending` subscriptions row via POST /api/create-subscription
//   - passes additionalJSON.subscription_id so the Helio webhook can correlate
//   - reads paylinkId from the `plans` table (DB = source of truth), NOT from
//     the NEXT_PUBLIC_NTA_SIGNALSCOUT env var (presence ≠ value gotcha).
//
// Kept for reference only; only the dead `selectplans.jsx` chain still imports
// it. Delete alongside that chain when it is removed.
// =============================================================================
import { HelioCheckout } from "@heliofi/checkout-react";

const helioConfig = {
  paylinkId: process.env.NEXT_PUBLIC_NTA_SIGNALSCOUT, //||  "6887fd0323a031902fad1edf",
  display: "button",
  network: process.env.HELIO_NETWORK || "test", //not required for production
  primaryColor: "#5865f2", //"#fede1c",
  neutralColor: "#e0e3ff",
  textColor: "#242424",
  theme: {
    themeMode: "dark",
  },

  customTexts: {
    mainButtonTitle: " Signal Scout ",
  },
  onSuccess: (event) => console.log(event),
  onError: (event) => console.log(event),
  onPending: (event) => console.log(event),
  onCancel: () => console.log("Cancelled payment"),
  onStartPayment: () => console.log("Starting payment"),
};

export default function CheckoutSignalScout() {
  return (
    <div className="max-w-40">
      <HelioCheckout config={helioConfig} className="border-0 max-w-40" />
    </div>
  );
}
