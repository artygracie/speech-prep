import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { IS_INDEXABLE, SITE_URL } from "@/lib/site";
import { ATTRIBUTION_SNIPPET } from "@/lib/attribution";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const TITLE = "SpeechPrep — Practice your speech before you give it.";
const DESCRIPTION =
  "Practice your speech with AI feedback. Upload the script, record yourself, and see — to the second — which sections ran long, which lines you skipped, and which off-script moments landed better than what you wrote.";
const OG_DESCRIPTION =
  "AI rehearsal for prepared speech. Upload the script, record yourself, and see — to the second — what landed and what didn't.";

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
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
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
