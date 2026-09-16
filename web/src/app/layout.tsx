import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { IS_INDEXABLE, SITE_URL } from "@/lib/site";
import { ATTRIBUTION_SNIPPET } from "@/lib/attribution";

// Arty UI Layer 1 type, inherited verbatim: General Sans for body/UI,
// Sentient italic as the display accent. Self-hosted from src/fonts so
// every Artygroup product renders identically without a Google round-trip.
const generalSans = localFont({
  src: "../fonts/GeneralSans-Variable.woff2",
  variable: "--font-general-sans",
  weight: "200 700",
  display: "swap",
});

const sentient = localFont({
  src: "../fonts/Sentient-Variable-Italic.woff2",
  variable: "--font-sentient",
  weight: "200 700",
  style: "italic",
  display: "swap",
});

const TITLE = "SpeechPrep | Practice your speech before you give it";
const DESCRIPTION =
  "Read your speech out loud once and see the timing, the lines you skipped, and one thing to fix. Built for best man, maid of honor, and parent speeches. Try it on a sample, no account needed.";
const OG_DESCRIPTION =
  "Read your wedding speech out loud once and find out what it actually sounds like. Timing, skipped lines, one thing to fix.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  applicationName: "SpeechPrep",
  alternates: { canonical: "/" },
  manifest: "/site.webmanifest",
  robots: IS_INDEXABLE
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
  openGraph: {
    title: TITLE,
    description: OG_DESCRIPTION,
    url: SITE_URL,
    siteName: "SpeechPrep",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: OG_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${generalSans.variable} ${sentient.variable}`}>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-NHXRLNBQ"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          ></iframe>
        </noscript>
        {/* End Google Tag Manager (noscript) */}
        {/* First-touch attribution — writes utm params, gclid, and referrer
            into the 30-day sp_attr cookie on first visit. Persisted to
            profiles.attribution after signup (see src/lib/attribution.ts). */}
        <Script id="sp-attribution" strategy="afterInteractive">
          {ATTRIBUTION_SNIPPET}
        </Script>
        <Script id="google-tag-manager" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-NHXRLNBQ');`}
        </Script>
        {children}
        <Analytics />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=AW-18139578575"
          strategy="afterInteractive"
        />
        <Script id="google-ads" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'AW-18139578575');`}
        </Script>
      </body>
    </html>
  );
}
