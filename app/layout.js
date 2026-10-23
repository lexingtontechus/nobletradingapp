import { ClerkProvider } from "@clerk/nextjs";
import Header from "@/app/components/header";
import Footer from "./components/footer";
import { Analytics } from "@vercel/analytics/next";
import posthog from "posthog-js";

if (typeof window !== "undefined") {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.POSTHOG_API_HOST || "https://us.i.posthog.com",
    default_date: process.env.POSTHOG_DEFAULT_DATE || "2026-05-30",
  });
}

import { dark } from "@clerk/themes";
import "./globals.css";
import Logo from "./components/logo";
import { Cormorant_SC, IBM_Plex_Mono, Public_Sans } from "next/font/google";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const cormorantSc = Cormorant_SC({
  variable: "--font-cormorant-sc",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata = {
  title: "NOBLE TRADING APP",
  description:
    "Discover a thriving community dedicated to the art and science of business finance, focusing on managed investments and stock options analysis. Whether you’re a seasoned investor or just starting out, Noble Trading App welcomes all like-minded individuals looking to enhance their financial knowledge and capabilities.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider
      waitlistUrl="/waitlist"
      forceRedirectUrl="/dashboard"
      appearance={{
        layout: {
          logoPlacement: "inside",
          logoImageUrl: <Logo size={12} padding={0} />,
          showOptionalFields: "false",
        },
        baseTheme: dark,
        mode: "modal",
        popup: true,
      }}
    >
      <html lang="en" className="dark">
        <body
          className={`${publicSans.variable} ${cormorantSc.variable} ${ibmPlexMono.variable} antialiased`}
        >
          <Header />
          {children}
          <Footer />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
