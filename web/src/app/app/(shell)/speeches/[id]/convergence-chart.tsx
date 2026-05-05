// Convergence chart. Tiny inline-SVG bar chart that shows total
// spoken length per draft, plotted against the target time, so the
// user can see the speech "settling" into its target as drafts evolve.
//
// One bar per draft that has at least one recorded session. Bar value
// is the median actual_seconds across sessions recorded against that
// draft (median, not mean — one bad take shouldn't drag the bar). A
// horizontal line marks the target. The bar is colored:
//   - green if within ±5s of target
//   - gold if under target by more than 5s
//   - red  if over target by more than 5s
//
// No chart library; this is plain SVG so it stays lean.

type Datum = {
  v: number;
  actualSeconds: number;
  status: "match" | "under" | "over";
};

type Props = {
  data: Datum[];
  targetSeconds: number;
};

function fmtMin(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const COLOR = {
  match: "var(--color-deliver-green)",
  under: "var(--color-engagement-gold)",
  over: "var(--color-leadgen-red)",
};

export function ConvergenceChart({ data, targetSeconds }: Props) {
  if (data.length === 0) return null;

  const W = 520;
  const H = 160;
  const PAD_LEFT = 36;
  const PAD_RIGHT = 12;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 28;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  // y-axis: 0 to (max(actual, target) * 1.15) so bars never touch top.
  const maxVal = Math.max(
    targetSeconds,
    ...data.map((d) => d.actualSeconds),
  );
  const yMax = Math.max(maxVal * 1.15, 30);

  const barCount = data.length;
  const barGap = 8;
  const barW = Math.max(
    8,
    (innerW - barGap * (barCount - 1)) / barCount,
  );

  const targetY = PAD_TOP + innerH * (1 - targetSeconds / yMax);

  return (
    <div>
      <h2 className="text-heading">Convergence</h2>
      <p
        className="text-body mt-2"
        style={{ color: "var(--color-muted-ash)" }}
      >
        Total spoken length per draft. The dashed line is your target —
        the bars should settle toward it as you iterate.
      </p>
      <div
        className="mt-5"
        style={{
          background: "var(--color-canvas-white)",
          borderRadius: 12,
          border: "1px solid rgba(17,17,17,0.06)",
          padding: "16px 18px",
          overflowX: "auto",
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label="Convergence chart of total length per draft against target"
          style={{ maxWidth: W, display: "block" }}
        >
          {/* y-axis target label */}
          <text
            x={4}
            y={targetY + 3}
            fontSize="10"
            fill="var(--color-muted-ash)"
          >
            {fmtMin(targetSeconds)}
          </text>
          {/* target line */}
          <line
            x1={PAD_LEFT}
            x2={W - PAD_RIGHT}
            y1={targetY}
            y2={targetY}
            stroke="var(--color-muted-ash)"
            strokeDasharray="3 3"
            strokeWidth="1"
            opacity="0.5"
          />

          {/* bars */}
          {data.map((d, i) => {
            const h = innerH * (d.actualSeconds / yMax);
            const x = PAD_LEFT + i * (barW + barGap);
            const y = PAD_TOP + innerH - h;
            return (
              <g key={d.v}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  fill={COLOR[d.status]}
                  rx="3"
                  opacity="0.85"
                />
                {/* actual seconds tooltip-ish */}
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  fontSize="9"
                  textAnchor="middle"
                  fill="var(--color-muted-ash)"
                >
                  {fmtMin(d.actualSeconds)}
                </text>
                {/* x-axis label */}
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  fontSize="10"
                  textAnchor="middle"
                  fill="var(--color-muted-ash)"
                >
                  v{d.v}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
