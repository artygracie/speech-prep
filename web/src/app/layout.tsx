import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { IS_INDEXABLE, SITE_URL } from "@/lib/site";

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
        {children}
        <Analytics />
      </body>
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
    </html>
  );
}
