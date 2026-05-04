import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "SpeechPrep — Practice your speech before you give it.",
  description:
    "Practice your speech with AI feedback. Upload the script, record yourself, and see — to the second — which sections ran long, which lines you skipped, and which off-script moments landed better than what you wrote.",
  metadataBase: new URL("https://speechprep.ai"),
  icons: {
    icon: "/assets/Logo.svg",
    apple: "/assets/Logo.svg",
  },
  openGraph: {
    title: "SpeechPrep — Practice your speech before you give it.",
    description:
      "AI rehearsal for prepared speech. Upload the script, record yourself, and see — to the second — what landed and what didn't.",
    siteName: "SpeechPrep",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SpeechPrep — Practice your speech before you give it.",
    description:
      "AI rehearsal for prepared speech. Upload the script, record yourself, and see — to the second — what landed and what didn't.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
