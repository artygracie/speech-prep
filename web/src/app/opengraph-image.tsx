import { ImageResponse } from "next/og";

export const alt = "SpeechPrep — The room before the room.";
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
const GEIST_MONO_MEDIUM =
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@500&display=swap";

async function loadGoogleFont(cssUrl: string): Promise<ArrayBuffer> {
  const css = await fetch(cssUrl, {
    // Google serves a different .ttf payload per UA. A modern Chrome UA
    // gets us a single static TTF that Satori can consume.
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    },
  }).then((r) => r.text());
  const match = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/);
  if (!match) throw new Error(`Could not find .ttf in ${cssUrl}`);
  const fontRes = await fetch(match[1]);
  return fontRes.arrayBuffer();
}

export default async function Image() {
  const [serifRegular, serifItalic, monoMedium] = await Promise.all([
    loadGoogleFont(INSTRUMENT_SERIF_REGULAR),
    loadGoogleFont(INSTRUMENT_SERIF_ITALIC),
    loadGoogleFont(GEIST_MONO_MEDIUM),
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
              fontFamily: "Geist Mono, monospace",
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
            The room before
          </div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div
              style={{
                fontSize: 168,
                fontStyle: "italic",
                letterSpacing: "-0.02em",
              }}
            >
              the
            </div>
            <div style={{ fontSize: 168, letterSpacing: "-0.02em" }}>
              {" room."}
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
          name: "Geist Mono",
          data: monoMedium,
          weight: 500,
          style: "normal",
        },
      ],
    },
  );
}
