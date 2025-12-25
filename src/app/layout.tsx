import "./globals.css";
import { Inter, Playfair_Display } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-serif",
});

import { type Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://allabouttax.in"),
  title: {
    default: "All About Tax | AI Tax Expert for India",
    template: "%s | All About Tax",
  },
  description:
    "Simplify Indian Tax Laws with our AI Tax Expert. Get instant answers to your GST, Income Tax, and corporate tax queries.",
  keywords: [
    "India Tax",
    "GST",
    "Income Tax",
    "AI Tax Assistant",
    "Tax Consultant",
    "Finance India",
  ],
  authors: [{ name: "All About Tax Team" }],
  creator: "All About Tax",
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://allabouttax.in",
    title: "All About Tax | AI Tax Expert for India",
    description:
      "Simplify Indian Tax Laws with our AI Tax Expert. Get instant answers to your tax queries.",
    siteName: "All About Tax",
  },
  twitter: {
    card: "summary_large_image",
    title: "All About Tax | AI Tax Expert for India",
    description:
      "Simplify Indian Tax Laws with our AI Tax Expert. Get instant answers to your tax queries.",
    creator: "@allabouttax_in",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${playfair.variable} font-sans antialiased text-slate-900`}
      >
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
