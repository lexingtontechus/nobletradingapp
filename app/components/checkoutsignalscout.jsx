import { HelioCheckout } from "@heliofi/checkout-react";

const helioConfig = {
  paylinkId: "6887fd0323a031902fad1edf",
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
