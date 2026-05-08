import { ImageResponse } from "next/og";

export const alt = "SpeechPrep — Don't just give a speech. Give the speech.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Google Fonts CSS-API endpoints. We pull the .ttf URL out of each
// stylesheet at render time and stream it into the ImageResponse so
// Satori can shape the headline correctly. Fetched on the edge once
// per build, then cached.
const INSTRUMENT_SERIF_REGULAR =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap";
const INSTRUMENT_SERIF_ITALIC =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&display=swap";
// JetBrains Mono stands in for Geist Mono here. Satori (next/og's font
// engine) chokes on Geist Mono's GSUB lookupType 6 — JetBrains Mono is
// visually the closest grotesk-style mono on Google Fonts that parses
// cleanly. The pill text is short and uppercase so the substitution is
// visually invisible at thumbnail sizes.
const PILL_MONO_MEDIUM =
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&display=swap";

async function loadGoogleFont(cssUrl: string): Promise<ArrayBuffer> {
  // Modern UAs get woff2 from Google Fonts, which Satori can't consume.
  // An ancient UA forces Google to serve a single consolidated TTF.
  const css = await fetch(cssUrl, {
    headers: { "User-Agent": "Mozilla/4.0" },
  }).then((r) => r.text());
  const match = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/);
  if (!match) throw new Error(`Could not find .ttf in ${cssUrl}`);
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

export default async function Image() {
  const [serifRegular, serifItalic, pillMono] = await Promise.all([
    loadGoogleFont(INSTRUMENT_SERIF_REGULAR),
    loadGoogleFont(INSTRUMENT_SERIF_ITALIC),
    loadGoogleFont(PILL_MONO_MEDIUM),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "76px 88px",
          // Soft diagonal pastel — peach → pink → lavender → blue → mint.
          // Approximated from the Paper file's oklab() stops since Satori
          // doesn't support oklab().
          background:
            "linear-gradient(135deg, #fbeee2 0%, #f4dfdc 25%, #e9d8e0 50%, #d8e0e8 75%, #dde7df 100%)",
          color: "#0e0e0e",
          fontFamily: "Instrument Serif, serif",
        }}
      >
        {/* Pill tag */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "white",
            borderRadius: 999,
            padding: "14px 26px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#e8400d",
            }}
          />
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#1a1a1a",
            }}
          >
            Practice your speech before you give it
          </div>
        </div>

        {/* Headline — two stacked lines, italic "the" inline on line 2 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            // Tight line-height pulls the two lines close together,
            // matching the Paper file (font-size 148 / line-height 35
            // there → ~0.27 ratio; we use a similar visually-tight
            // value here at 1200×630 scale).
            lineHeight: 0.95,
          }}
        >
          <div
            style={{
              fontSize: 168,
              letterSpacing: "-0.02em",
            }}
          >
            Don&rsquo;t just give a speech.
          </div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontSize: 168, letterSpacing: "-0.02em", marginRight: "0.28em" }}>
              Give
            </div>
            <div
              style={{
                fontSize: 168,
                fontStyle: "italic",
                letterSpacing: "-0.02em",
                marginRight: "0.28em",
              }}
            >
              the
            </div>
            <div style={{ fontSize: 168, letterSpacing: "-0.02em" }}>
              speech.
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Instrument Serif",
          data: serifRegular,
          weight: 400,
          style: "normal",
        },
        {
          name: "Instrument Serif",
          data: serifItalic,
          weight: 400,
          style: "italic",
        },
        {
          name: "JetBrains Mono",
          data: pillMono,
          weight: 500,
          style: "normal",
        },
      ],
    },
  );
}
