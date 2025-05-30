import { ClerkProvider } from "@clerk/nextjs";
import Header from "@/app/components/header";
import Footer from "./components/footer";
import { Analytics } from "@vercel/analytics/next";
import { dark } from "@clerk/themes";
import "./globals.css";
import Logo from "./components/logo";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "NOBLE TRADING APP",
  description:
    "Discover a thriving community dedicated to the art and science of business finance, focusing on managed investments and stock options analysis. Whether you’re a seasoned investor or just starting out, Noble Trading App welcomes all like-minded individuals looking to enhance their financial knowledge and capabilities.",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider
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
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased capitalize`}
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
