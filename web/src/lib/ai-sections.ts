// Server-only AI helpers for splitting a speech into sections and naming
// them. We use Claude Haiku 4.5 for both because they're short, structured
// jobs and we want sub-2-second round-trips on the new-speech and editor
// flows. If ANTHROPIC_API_KEY is unset, callers get null and should fall
// back to the paragraph-split / positional-name heuristic — never block
// the create flow on the AI being unavailable.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type ProposedSection = { name: string; body: string };

// Splits a raw speech body into 4-7 logical sections (open / setup / story
// beats / turn / close — whatever fits) with short 1-2 word titles. The
// model receives the full text verbatim and is asked to return the same
// text re-grouped, so we can verify nothing got rewritten.
export async function aiSplitSections(
  text: string,
): Promise<ProposedSection[] | null> {
  const c = client();
  if (!c) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const prompt = `You split a speech draft into 4–7 logical sections that match how a speaker would think of the structure (e.g. open, setup, story beats, turn, close — pick what fits this speech). Each section is a coherent beat.

Rules:
- Use the speech text verbatim. Do not rewrite, summarize, or reorder. Only choose where the breaks go.
- Section names: 1–2 words, title case, evocative not generic. Avoid "Section 1", "Body", "Conclusion".
- Return strict JSON: {"sections":[{"name":"...","body":"..."}]}. No prose, no markdown, no code fences.
- The concatenated bodies (joined with a single newline) must equal the input text with whitespace normalized.

Speech:
<<<
${trimmed}
>>>`;

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = parseJson(block.text) as
      | { sections?: Array<{ name?: unknown; body?: unknown }> }
      | null;
    const sections = parsed?.sections;
    if (!Array.isArray(sections) || sections.length === 0) return null;
    const cleaned: ProposedSection[] = [];
    for (const s of sections) {
      const name = typeof s?.name === "string" ? s.name.trim() : "";
      const body = typeof s?.body === "string" ? s.body.trim() : "";
      if (!name || !body) continue;
      cleaned.push({ name, body });
    }
    if (cleaned.length === 0) return null;
    return cleaned;
  } catch (err) {
    // Don't block the create flow — caller falls back to paragraph split.
    console.warn("[ai-sections] split failed", err);
    return null;
  }
}

// Re-names existing sections without restructuring them. Used by the
// "Suggest names" button in the editor. Returns one name per input
// section, in order, or null on failure.
export async function aiNameSections(
  sections: Array<{ body: string }>,
): Promise<string[] | null> {
  const c = client();
  if (!c) return null;
  if (sections.length === 0) return [];

  const list = sections
    .map((s, i) => `[${i + 1}]\n${s.body.trim()}`)
    .join("\n\n---\n\n");

  const prompt = `You name speech sections. For each numbered section, give a 1–2 word title in Title Case that captures the beat (Open, Story, Turn, Close, Aside, Coda — but tailored to the actual content). Avoid generic labels like "Section 1", "Body", "Conclusion".

Return strict JSON: {"names":["...","..."]}. One name per section, in order. No prose, no markdown, no code fences.

${list}`;

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;
    const parsed = parseJson(block.text) as { names?: unknown } | null;
    const names = parsed?.names;
    if (!Array.isArray(names)) return null;
    if (names.length !== sections.length) return null;
    const out: string[] = [];
    for (const n of names) {
      if (typeof n !== "string" || !n.trim()) return null;
      out.push(n.trim());
    }
    return out;
  } catch (err) {
    console.warn("[ai-sections] name failed", err);
    return null;
  }
}

// Tolerates a stray code fence around the JSON, which Haiku occasionally
// emits even when asked not to.
function parseJson(s: string): unknown {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
