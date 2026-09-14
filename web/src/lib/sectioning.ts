// Heuristic section splitting — the fallback when the AI sectioner is
// unavailable, and the only sectioner the anonymous demo uses (the demo
// must not spend an Anthropic call before the coach call).
//
// Extracted from app/app/actions.ts so both the authed create flows and
// the unauthenticated /api/demo/report route can share one implementation.
// Pure: no DB, no auth, no network.

export type ProposedSection = {
  name: string;
  target_seconds: number;
  body: string;
};

// 145 wpm, rounded to the nearest 5s, minimum 15s.
export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(15, Math.round(((words / 145) * 60) / 5) * 5);
}

export function autoSection(text: string): ProposedSection[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return [{ name: "Open", target_seconds: 60, body: "" }];
  }
  if (blocks.length === 1) {
    const sentences = blocks[0].match(/[^.!?]+[.!?]+/g) ?? [blocks[0]];
    const mid = Math.ceil(sentences.length / 2);
    return [
      {
        name: "Open",
        target_seconds: estimateSeconds(sentences.slice(0, mid).join(" ")),
        body: sentences.slice(0, mid).join(" ").trim(),
      },
      {
        name: "Close",
        target_seconds: estimateSeconds(sentences.slice(mid).join(" ")),
        body: sentences.slice(mid).join(" ").trim() || sentences.join(" ").trim(),
      },
    ];
  }
  const names = ["Open", "Story", "Turn", "Close", "Aside", "Coda"];
  return blocks.map((b, i) => ({
    name: names[i] ?? `Section ${i + 1}`,
    target_seconds: estimateSeconds(b),
    body: b,
  }));
}
