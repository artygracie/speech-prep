import { ImageResponse } from "next/og";

export const alt = "SpeechPrep — Practice your speech before you give it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background:
            "linear-gradient(135deg, #fef3e8 0%, #fde7d4 35%, #fbd5b8 100%)",
          color: "#111111",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          SpeechPrep
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 980,
            }}
          >
            Practice your speech before you give it.
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              color: "#3a3a3a",
              maxWidth: 900,
            }}
          >
            Upload the script. Record yourself. See — to the second — what
            landed and what didn&apos;t.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: 24,
            color: "#5a5a5a",
          }}
        >
          <span>speechprep.ai</span>
          <span style={{ fontStyle: "italic" }}>The room before the room.</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
