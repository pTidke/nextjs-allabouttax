import "./globals.css";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import Providers from "@/components/providers/Providers";

// Headlines in the serif, reading text in the sans, labels in the mono.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});
const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-plex-serif",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

import { type Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://allabouttax.in"),
  title: {
    default: "All About Tax | Indian Income-tax Research",
    template: "%s | All About Tax",
  },
  description:
    "Explore reviewed official Indian income-tax sources with period-aware explanations and citations.",
  keywords: [
    "India Tax",
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
    title: "All About Tax | Indian Income-tax Research",
    description:
      "Explore reviewed official Indian income-tax sources with explanations and citations.",
    siteName: "All About Tax",
  },
  twitter: {
    card: "summary_large_image",
    title: "All About Tax | Indian Income-tax Research",
    description:
      "Explore reviewed official Indian income-tax sources with explanations and citations.",
    creator: "@allabouttax_in",
  },
  alternates: {
    canonical: "https://allabouttax.in",
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
        className={`${sans.variable} ${serif.variable} ${mono.variable} flex min-h-screen flex-col`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "WebSite",
                  "@id": "https://allabouttax.in/#website",
                  url: "https://allabouttax.in",
                  name: "All About Tax",
                  description: "Indian income-tax research",
                  publisher: {
                    "@id": "https://allabouttax.in/#organization",
                  },
                },
                {
                  "@type": "Organization",
                  "@id": "https://allabouttax.in/#organization",
                  name: "All About Tax",
                  url: "https://allabouttax.in",
                  logo: {
                    "@type": "ImageObject",
                    url: "https://allabouttax.in/logo.png",
                  },
                  sameAs: [
                    "https://twitter.com/allabouttax_in",
                    "https://www.linkedin.com/company/allabouttax",
                  ],
                  contactPoint: {
                    "@type": "ContactPoint",
                    contactType: "customer support",
                    email: "hello@allabouttax.in",
                  },
                },
              ],
            }),
          }}
        />
        <Providers>
          <Header />
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
