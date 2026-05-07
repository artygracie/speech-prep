"use client";

// ManuscriptScript — the session report's primary surface.
//
// Two-column layout:
//   - Left: the user's script as a manuscript, with coach edits and
//     speaker deviations as inline track-changes. The manuscript is
//     reading material — no buttons, no chrome on the lines.
//   - Right: a comments rail (Google-Docs style) anchoring one card
//     per coach edit. Each card has the full reason, the kind/
//     section meta, and the Accept/Reject buttons. Drills get their
//     own card with the tactic text.
//
// Hover an inline edit mark on the left → the matching card on the
// right activates. Click an active card → the manuscript scrolls to
// the anchor and flashes it. The two columns are kept in sync via
// scroll-into-view, no virtualization or heavy state.
//
// Three view modes (toggle, sticky at the top of the manuscript):
//   "coach"   — show coach-edit marks in the manuscript + the
//               comments rail (default).
//   "spoken"  — show speaker deviations from the script in the
//               manuscript instead. The rail is hidden in this view
//               (deviations aren't actionable cards, they're
//               observations).
//   "both"    — show both layers, comments rail visible.
//
// On apply, accepted coach-edit ids are sent to the existing
// applySuggestionsAndRecord server action — same path as before.

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  applySuggestions,
  applySuggestionsAndRecord,
  applyDrillSuggestion,
} from "@/app/app/coach-actions";
import { MODE_PRIMARY_CTA, type SessionMode } from "@/lib/modes";
import type { DiffRow, WordOp } from "@/lib/alignment";

const DEFAULT_ACCEPT_COUNT = 3;

export type SuggestedEdit = {
  id: string;
  kind: "cut" | "adopt" | "rephrase" | "drill";
  section_id: string;
  before?: string;
  after?: string;
  // adopt-only (prompt v3+): the new text being inserted at the
  // `before` anchor. Pre-v3 reports may have only `after` (sometimes
  // a full revised passage). The renderer uses adoptInsertionFor()
  // to resolve which text to show.
  insertion?: string;
  reason: string;
  line_target?: string;
  tactic?: string;
  provenance?: "coach" | "user-flag" | "alignment";
};

// Pull the "what's being added" text out of an adopt edit.
// Mirrors the server-side resolveAdoptInsertion() but without the
// body-walking fallback (we don't have the body here when rendering
// rail cards). For pre-v3 adopts where `after` starts with `before`,
// we strip the prefix; otherwise show `after` as-is. The actual
// apply path uses the more thorough server-side recovery.
export function adoptInsertionFor(edit: SuggestedEdit): string {
  if (edit.insertion && edit.insertion.trim()) return edit.insertion.trim();
  const after = (edit.after ?? "").trim();
  if (!after) return "";
  if (edit.before) {
    const beforeLower = edit.before.trim().toLowerCase();
    const afterStart = after.toLowerCase().slice(0, beforeLower.length);
    if (afterStart === beforeLower) {
      return after.slice(beforeLower.length).replace(/^[\s.,;:!?]+/, "").trim();
    }
  }
  return after;
}

type SectionInput = {
  id: string;
  name: string;
  body: string;
  pacing?: {
    actualSeconds: number;
    targetSeconds: number;
    deltaSeconds: number;
  };
  memoryBand?: "word-perfect" | "mostly-there" | "rough" | "blank" | "not-reached";
  // Freestyle-only recall signals. recallPct is 0..1 from
  // computeMemoryCheck; spokenSnippet is the first-spoken-words for
  // a "you got this far:" treatment on rough sections; hadLongPause
  // surfaces a small icon on the recall map tile when the user paused
  // for more than ~4 seconds in this section.
  recallPct?: number;
  spokenSnippet?: string | null;
  hadLongPause?: boolean;
};

// Two-mode tab system. With-script reports show editorial controls
// (coach edits, what you said, both); freestyle reports show recall-
// focused controls (recall view, transcript, edits). Internally they
// map onto the same three layer toggles — coach/spoken/both — but the
// labels and default change based on session mode.
type ViewMode = "coach" | "spoken" | "both";
type AcceptanceState = "accepted" | "pending" | "rejected";

// Observation = a speaker deviation from the script the coach didn't
// address with a proposed edit. Surfaces in the rail as informational
// — no Accept/Reject, just a callout.
//
// Paraphrase observations carry the structured WordOp list so the card
// can render proper inline track-changes (only the actually-changed
// words highlighted, not the entire row). Skipped observations carry
// the plain script text since there's nothing to compare against.
type ObservationItem = {
  kind: "observation";
  id: string;
  sectionId: string;
} & (
  | { deviation: "skipped"; written: string }
  | { deviation: "paraphrase"; ops: WordOp[] }
);

// The rail shows proposed edits AND observations together, ordered by
// where they appear in the manuscript.
type RailItem =
  | { kind: "edit"; edit: SuggestedEdit }
  | ObservationItem;

// A run of script body rendered with inline annotations.
type Token =
  | { kind: "text"; text: string }
  | {
      kind: "coach-edit";
      edit: SuggestedEdit;
      original: string; // matched substring from the body (for cut/rephrase)
    }
  | { kind: "speaker-skipped"; text: string }
  | { kind: "speaker-paraphrase"; ops: WordOp[] }
  | { kind: "speaker-improv"; spoken: string };

// ─── Tokenisation ────────────────────────────────────────────────────

function tokeniseCoachEdits(body: string, edits: SuggestedEdit[]): Token[] {
  const indexed = edits
    .filter((e) => e.kind !== "drill")
    .map((edit) => {
      if (edit.kind === "adopt" && !edit.before) {
        return { edit, idx: -1, len: 0 };
      }
      if (!edit.before) return null;
      const idx = body.toLowerCase().indexOf(edit.before.toLowerCase());
      if (idx < 0) return null;
      return { edit, idx, len: edit.before.length };
    })
    .filter((x): x is { edit: SuggestedEdit; idx: number; len: number } => x !== null)
    .sort((a, b) => {
      if (a.idx < 0 && b.idx < 0) return 0;
      if (a.idx < 0) return 1;
      if (b.idx < 0) return -1;
      return a.idx - b.idx;
    });

  const tokens: Token[] = [];
  let cursor = 0;

  for (const { edit, idx, len } of indexed) {
    if (idx < 0) continue;
    if (idx < cursor) continue;
    if (idx > cursor) {
      tokens.push({ kind: "text", text: body.slice(cursor, idx) });
    }
    const matched = body.slice(idx, idx + len);
    tokens.push({ kind: "coach-edit", edit, original: matched });
    cursor = idx + len;
  }

  if (cursor < body.length) {
    tokens.push({ kind: "text", text: body.slice(cursor) });
  }

  for (const { edit, idx } of indexed) {
    if (idx < 0) {
      tokens.push({ kind: "coach-edit", edit, original: "" });
    }
  }

  return tokens;
}

// Some "rephrase" suggestions are *defensive* — the coach is saying
// "the speaker drifted, but the script's wording is actually better;
// keep the script as written." The data model doesn't carry direction
// today, so we infer it from reason text. Brittle but immediate; the
// real fix is a `direction` field on the coach prompt output.
//
// When we detect a defensive rephrase, the card flips: it shows the
// script version as the recommended text (no strikethrough), the
// spoken version as a small "you said" annotation, and the action
// button reads "Keep as written" instead of "Accept" (because there
// is no script change to apply — accepting the coach's recommendation
// here means *making no change*).
const DEFENSIVE_PHRASES = [
  "wait —",
  "wait,",
  "reverse this",
  "reverse it",
  "actually keep",
  "actually, keep",
  "keep the script",
  "keep what you wrote",
  "keep what's in the script",
  "keep the original",
  "stick with the script",
  "stay with the script",
  "don't change",
  "do not change",
  "leave this",
  "leave as is",
  "leave it as written",
];
export function isDefensiveRephrase(reason: string | undefined): boolean {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return DEFENSIVE_PHRASES.some((p) => lower.includes(p));
}

// ─── Body-position overlap helpers ───────────────────────────────────
//
// Used to decide whether a coach edit and a diff row anchor at the
// same place in the script body. Tokenise once, then resolve each
// edit / row to a [start, end) token-index range and test for
// overlap.
//
// The point: substring-contains was an over-approximation that
// caught nothing useful — paraphrase rows accumulate the entire
// row's worth of script text, which a tight coach `before` could
// never contain. This also gives us the surface to suppress
// observations near adopt edits, which have no `before` at all.

function tokeniseLower(s: string): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

type TokenRange = [number, number] | null;

function findTokenRange(haystack: string[], needle: string): TokenRange {
  const ns = tokeniseLower(needle);
  if (ns.length === 0 || haystack.length === 0) return null;
  outer: for (let i = 0; i + ns.length <= haystack.length; i++) {
    for (let j = 0; j < ns.length; j++) {
      if (haystack[i + j] !== ns[j]) continue outer;
    }
    return [i, i + ns.length];
  }
  // Fall back to longest-common-substring approximation: find the
  // first token of `needle` and treat the row as anchoring there
  // even if the rest doesn't match exactly. Useful when paraphrase
  // text drifts from the script body wording.
  const firstIdx = haystack.indexOf(ns[0]);
  if (firstIdx >= 0) return [firstIdx, firstIdx + 1];
  return null;
}

function rangesOverlap(a: TokenRange, b: TokenRange): boolean {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

// Two phrases share a "meaningful phrase" when they have ≥3 contiguous
// matching tokens. Used to decide whether an adopt edit's `after`
// covers what the speaker improvised in a paraphrase row, so we don't
// surface a redundant observation alongside the adopt suggestion.
const STOP_WORDS = new Set([
  "i", "a", "an", "the", "and", "or", "but", "of", "to", "is", "it",
  "in", "on", "at", "for", "with", "as", "be", "so", "that", "this",
]);
function sharesMeaningfulPhrase(a: string, b: string): boolean {
  const at = tokeniseLower(a);
  const bt = tokeniseLower(b);
  if (at.length < 3 || bt.length < 3) return false;
  // Slide a 3-token window over `a`; if any window has all three
  // tokens appearing in order in `b`, treat it as a match.
  for (let i = 0; i + 3 <= at.length; i++) {
    const w0 = at[i],
      w1 = at[i + 1],
      w2 = at[i + 2];
    if (STOP_WORDS.has(w0) && STOP_WORDS.has(w1) && STOP_WORDS.has(w2)) continue;
    for (let j = 0; j + 3 <= bt.length; j++) {
      if (bt[j] === w0 && bt[j + 1] === w1 && bt[j + 2] === w2) return true;
    }
  }
  return false;
}

// Word-level diff between a coach rephrase's `before` (script wording)
// and `after` (proposed wording). Produces the same WordOp[] shape the
// alignment library emits, so we can render rephrase cards with the
// exact same inline track-changes treatment as paraphrase observations
// — only the actually-changed words are highlighted.
//
// LCS-based: find the longest common subsequence of normalised tokens,
// then walk both arrays emitting equal/sub/del/ins ops. Two consecutive
// del+ins ops at the same position get coalesced into a single sub so
// the renderer shows them inline ("fourteen → twelve") rather than
// stacked.
function diffWordsToOps(before: string, after: string): WordOp[] {
  const splitWithSurface = (s: string) =>
    s
      .split(/(\s+)/)
      .filter((p) => p && !/^\s+$/.test(p))
      .map((surface) => ({ surface, key: surface.toLowerCase().replace(/[‘’']/g, "").replace(/[^\p{L}\p{N}]+/gu, "") }))
      .filter((t) => t.key.length > 0);

  const a = splitWithSurface(before);
  const b = splitWithSurface(after);

  // Standard LCS DP.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i].key === b[j].key) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: WordOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i].key === b[j].key) {
      ops.push({ kind: "equal", text: a[i].surface });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "del", written: a[i].surface });
      i++;
    } else {
      ops.push({ kind: "ins", spoken: b[j].surface });
      j++;
    }
  }
  while (i < m) ops.push({ kind: "del", written: a[i++].surface });
  while (j < n) ops.push({ kind: "ins", spoken: b[j++].surface });

  // Coalesce adjacent del+ins (or ins+del) into a single sub so the
  // renderer shows the swap inline.
  const coalesced: WordOp[] = [];
  for (const op of ops) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.kind === "del" && op.kind === "ins") {
      coalesced[coalesced.length - 1] = {
        kind: "sub",
        written: last.written,
        spoken: op.spoken,
      };
      continue;
    }
    if (last && last.kind === "ins" && op.kind === "del") {
      coalesced[coalesced.length - 1] = {
        kind: "sub",
        written: op.written,
        spoken: last.spoken,
      };
      continue;
    }
    coalesced.push(op);
  }
  return coalesced;
}

function tokeniseSpokenDeviations(diffRows: DiffRow[], sectionId: string): Token[] {
  const rows = diffRows.filter((r) => r.sectionId === sectionId);
  const tokens: Token[] = [];
  for (const row of rows) {
    if (row.kind === "match") {
      tokens.push({ kind: "text", text: row.spoken + " " });
    } else if (row.kind === "skipped") {
      tokens.push({ kind: "speaker-skipped", text: row.written + " " });
    } else if (row.kind === "paraphrase") {
      tokens.push({ kind: "speaker-paraphrase", ops: row.ops });
    } else if (row.kind === "improv") {
      tokens.push({ kind: "speaker-improv", spoken: row.spoken + " " });
    }
  }
  return tokens;
}

// ─── Component ───────────────────────────────────────────────────────

export function ManuscriptScript({
  speechId,
  sessionId,
  mode,
  sections,
  suggestedEdits,
  diffRows,
}: {
  speechId: string;
  sessionId: string;
  mode: SessionMode;
  sections: SectionInput[];
  suggestedEdits: SuggestedEdit[];
  diffRows: DiffRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Default tab differs by mode. With-script users come here to edit
  // and want the coach edits inline; freestyle users come here to see
  // how memorization went and want the recall view (which renders
  // band-appropriate per-section cards instead of the full manuscript).
  // We map the freestyle "recall" tab onto the existing "coach" view
  // mode internally — there's only one layer toggle under the hood.
  const [viewMode, setViewMode] = useState<ViewMode>("coach");
  const [activeEditId, setActiveEditId] = useState<string | null>(null);

  // DOM refs for the bidirectional scroll-into-view between manuscript
  // anchors and rail cards. Keyed by edit id.
  const anchorRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const cardRefs = useRef<Map<string, HTMLElement | null>>(new Map());

  const setAnchorRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) anchorRefs.current.set(id, el);
    else anchorRefs.current.delete(id);
  }, []);
  const setCardRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const initialAcceptance = useMemo(() => {
    const map = new Map<string, AcceptanceState>();
    let accepted = 0;
    for (const edit of suggestedEdits) {
      if (edit.kind === "drill") {
        map.set(edit.id, "pending");
        continue;
      }
      // Defensive rephrases (coach saying "keep the script") shouldn't
      // be pre-accepted, since accepting would commit the speaker's
      // worse version. Leave them pending so the user actively
      // chooses "Keep as written."
      if (edit.kind === "rephrase" && isDefensiveRephrase(edit.reason)) {
        map.set(edit.id, "pending");
        continue;
      }
      if (accepted < DEFAULT_ACCEPT_COUNT) {
        map.set(edit.id, "accepted");
        accepted += 1;
      } else {
        map.set(edit.id, "pending");
      }
    }
    return map;
  }, [suggestedEdits]);
  const [acceptance, setAcceptance] = useState<Map<string, AcceptanceState>>(
    initialAcceptance,
  );

  function setEdit(id: string, state: AcceptanceState) {
    setAcceptance((prev) => {
      const next = new Map(prev);
      next.set(id, state);
      return next;
    });
  }

  const editsBySection = useMemo(() => {
    const map = new Map<string, SuggestedEdit[]>();
    for (const e of suggestedEdits) {
      const arr = map.get(e.section_id) ?? [];
      arr.push(e);
      map.set(e.section_id, arr);
    }
    return map;
  }, [suggestedEdits]);

  const acceptedEdits = useMemo(
    () =>
      suggestedEdits.filter(
        (e) => acceptance.get(e.id) === "accepted" && e.kind !== "drill",
      ),
    [suggestedEdits, acceptance],
  );

  // Section bodies indexed for the overlap check below. We tokenise
  // each section body once into a lowercase word array; an edit's
  // `before` and a row's written text both resolve to a token-range
  // inside this array, and we check overlap by index.
  const sectionTokensById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of sections) {
      map.set(s.id, tokeniseLower(s.body));
    }
    return map;
  }, [sections]);

  // Observations: speaker deviations from the script the coach didn't
  // address with an edit. We surface skips and paraphrases the user
  // should know about even when they aren't actionable. No Accept /
  // Reject — these are informational. Improvs are excluded.
  //
  // The "addressed" check is body-position based: each coach edit and
  // each diff row resolves to a token range in the script body, and
  // any overlap means the coach has already covered this span. The
  // earlier substring-contains check missed adopt edits (no `before`)
  // and false-positively flagged whole sections as observations.
  const observations: ObservationItem[] = useMemo(() => {
    if (diffRows.length === 0) return [];
    const out: ObservationItem[] = [];
    let i = 0;

    // In freestyle mode, suppress observations on sections the user
    // blanked or barely reached. Showing "you skipped this" or "you
    // phrased this differently" on a blanked section is rubbing the
    // failure in — the user already knows they didn't have it. The
    // recall scoreboard / memory-band chip carries that signal more
    // gently. The drill plan tells them what to do next.
    const suppressedSections = new Set<string>();
    if (mode === "freestyle") {
      for (const sec of sections) {
        if (
          sec.memoryBand === "blank" ||
          sec.memoryBand === "rough" ||
          sec.memoryBand === "not-reached"
        ) {
          suppressedSections.add(sec.id);
        }
      }
    }

    for (const row of diffRows) {
      if (row.kind !== "skipped" && row.kind !== "paraphrase") continue;
      if (suppressedSections.has(row.sectionId)) continue;

      // Quick filter: very short paraphrases are noise (the / a, etc.).
      // Use the count of *changed* word ops, not total — a long row
      // with only one sub shouldn't be an observation either.
      if (row.kind === "paraphrase") {
        const changedOps = row.ops.filter(
          (o) => o.kind === "del" || o.kind === "sub" || o.kind === "ins",
        ).length;
        if (changedOps < 2) continue;
      }

      const tokens = sectionTokensById.get(row.sectionId) ?? [];
      const writtenText =
        row.kind === "skipped"
          ? row.written
          : // For overlap detection only: use the *equal + del + sub*
            // tokens (the script-side of the row) so we know where in
            // the body this row anchors.
            row.ops
              .filter((o) => o.kind === "equal" || o.kind === "del" || o.kind === "sub")
              .map((o) => (o.kind === "equal" ? o.text : "written" in o ? o.written : ""))
              .join(" ");
      const rowRange = findTokenRange(tokens, writtenText);

      const sectionEdits = editsBySection.get(row.sectionId) ?? [];
      const addressed = sectionEdits.some((edit) => {
        if (edit.kind === "drill") return false;

        // Cut / rephrase: anchored on `before` in the body.
        if (edit.before) {
          const editRange = findTokenRange(tokens, edit.before);
          if (rangesOverlap(rowRange, editRange)) return true;
        }

        // Adopt: anchored at an insertion point. We approximate by
        // checking whether the spoken side of THIS row (paraphrase or
        // improv) shares meaningful word content with the adopt's
        // `after`. If the speaker's improv is the thing being adopted,
        // we don't separately ping the user about it.
        if (edit.kind === "adopt" && edit.after && row.kind === "paraphrase") {
          const spoken = row.ops
            .filter((o) => o.kind === "equal" || o.kind === "ins" || o.kind === "sub")
            .map((o) =>
              o.kind === "equal" ? o.text : "spoken" in o ? o.spoken : "",
            )
            .join(" ");
          if (sharesMeaningfulPhrase(spoken, edit.after)) return true;
        }

        return false;
      });
      if (addressed) continue;

      i += 1;
      if (row.kind === "skipped") {
        out.push({
          kind: "observation",
          id: `obs-${row.sectionId}-${i}`,
          sectionId: row.sectionId,
          deviation: "skipped",
          written: row.written,
        });
      } else {
        out.push({
          kind: "observation",
          id: `obs-${row.sectionId}-${i}`,
          sectionId: row.sectionId,
          deviation: "paraphrase",
          ops: row.ops,
        });
      }
    }
    return out;
  }, [diffRows, editsBySection, sectionTokensById, mode, sections]);

  // Combined rail content: proposed edits (with Accept/Reject) followed
  // by observations (informational only). Ordered by section position
  // so the rail mirrors the manuscript's flow.
  const railItems: RailItem[] = useMemo(() => {
    const sectionOrder = new Map<string, number>(
      sections.map((s, idx) => [s.id, idx]),
    );
    const all: RailItem[] = [
      ...suggestedEdits.map((edit) => ({ kind: "edit" as const, edit })),
      ...observations,
    ];
    return all.sort((a, b) => {
      const aSec = a.kind === "edit" ? a.edit.section_id : a.sectionId;
      const bSec = b.kind === "edit" ? b.edit.section_id : b.sectionId;
      const aIdx = sectionOrder.get(aSec) ?? 999;
      const bIdx = sectionOrder.get(bSec) ?? 999;
      if (aIdx !== bIdx) return aIdx - bIdx;
      // Within a section, edits before observations.
      if (a.kind !== b.kind) return a.kind === "edit" ? -1 : 1;
      return 0;
    });
  }, [suggestedEdits, observations, sections]);

  // Partition the rail into two clearly-labeled groups:
  //
  //   Script edits  = cut / adopt / rephrase suggestions. These are
  //                   the only items the Apply & record button acts
  //                   on. Each card has Accept / Reject (or "Keep
  //                   as written" for defensive rephrases).
  //
  //   Delivery notes = drill suggestions + observations (skips,
  //                    paraphrases the coach didn't propose an edit
  //                    for). Drills are actionable but don't change
  //                    the script; observations are pure information.
  //                    The Apply button never includes these.
  //
  // The partition makes the user's question — "what's the difference
  // between an Adopt and a 'You phrased differently' note?" — answer
  // itself: one group changes the script, the other doesn't.
  const scriptEditItems = useMemo(
    () =>
      railItems.filter(
        (item): item is { kind: "edit"; edit: SuggestedEdit } =>
          item.kind === "edit" &&
          (item.edit.kind === "cut" ||
            item.edit.kind === "adopt" ||
            item.edit.kind === "rephrase"),
      ),
    [railItems],
  );
  const deliveryNoteItems = useMemo(
    () =>
      railItems.filter(
        (item) =>
          item.kind === "observation" ||
          (item.kind === "edit" && item.edit.kind === "drill"),
      ),
    [railItems],
  );

  // Worst section by recall band — used in freestyle's layered view to
  // elevate that section's "Drill this section" button to a primary
  // black-filled CTA. Only set when the worst section is genuinely
  // weak (rough or worse); a word-perfect "worst" doesn't deserve
  // primary treatment.
  const worstSectionId = useMemo(
    () => pickWorstSectionId(sections),
    [sections],
  );

  // Activate an edit: scroll the corresponding rail card and manuscript
  // anchor into view, mark it active for highlighting.
  const activateEdit = useCallback((editId: string, source: "manuscript" | "rail") => {
    setActiveEditId(editId);
    const otherEl =
      source === "manuscript"
        ? cardRefs.current.get(editId)
        : anchorRefs.current.get(editId);
    if (otherEl) {
      otherEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  function applyAndRecord() {
    setError(null);
    startTransition(async () => {
      try {
        const ids = acceptedEdits.map((e) => e.id);
        if (ids.length > 0) {
          await applySuggestionsAndRecord(sessionId, ids);
        } else {
          router.push(`/app/speeches/${speechId}/record`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT")) return;
        setError(msg);
      }
    });
  }

  function applyOnly() {
    setError(null);
    startTransition(async () => {
      try {
        const ids = acceptedEdits.map((e) => e.id);
        if (ids.length === 0) return;
        const { newVersion } = await applySuggestions(sessionId, ids);
        router.push(`/app/speeches/${speechId}?applied=v${newVersion}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't apply.");
      }
    });
  }

  function startDrill(editId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await applyDrillSuggestion(sessionId, editId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("NEXT_REDIRECT")) return;
        setError(msg);
      }
    });
  }

  const primaryLabel = pending
    ? "Working…"
    : acceptedEdits.length === 0
    ? mode === "freestyle"
      ? "Practice again →"
      : "Record again →"
    : MODE_PRIMARY_CTA[mode];

  // The rail only renders when we have something to show (proposed
  // edits OR observations) and the view includes them. In "spoken"
  // view we hide the rail — speaker deviations are surfaced inline in
  // the manuscript at that point.
  const showRail =
    railItems.length > 0 && (viewMode === "coach" || viewMode === "both");

  return (
    <>
      <style>{`
        /* ─── Two-column layout ─────────────────────────────────── */
        .ms-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 32px;
          padding-bottom: 96px; /* room for sticky bar */
        }
        @media (min-width: 1100px) {
          .ms-grid.has-rail {
            grid-template-columns: minmax(0, 720px) minmax(280px, 360px);
            gap: 48px;
          }
        }

        /* ─── View toggle (sticky at top of manuscript column) ──── */
        .ms-toggle {
          position: sticky;
          top: 0;
          z-index: 10;
          background: var(--color-canvas-white);
          padding: 14px 0 12px;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1px solid rgba(17,17,17,0.06);
        }
        .ms-toggle-pill {
          appearance: none;
          background: transparent;
          border: 0;
          padding: 6px 12px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--color-muted-ash);
          cursor: pointer;
          border-radius: 999px;
          transition: background 120ms ease, color 120ms ease;
        }
        .ms-toggle-pill:hover { color: var(--color-midnight-ink); }
        .ms-toggle-pill[aria-selected="true"] {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
        }
        .ms-toggle-spacer { flex: 1; }
        .ms-toggle-meta {
          font-size: 11.5px;
          color: var(--color-muted-ash);
          letter-spacing: 0.04em;
        }

        /* ─── Section heading ───────────────────────────────────── */
        .ms-section { padding-top: 32px; }
        .ms-section:first-of-type { padding-top: 12px; }
        .ms-section-head {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 12px;
        }
        .ms-section-name {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-midnight-ink);
        }
        .ms-section-chip {
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.04em;
          padding: 2px 8px;
          border-radius: 999px;
          font-variant-numeric: tabular-nums;
        }
        .ms-section-chip.green { background: rgba(71, 208, 150, 0.14); color: #1f6f48; }
        .ms-section-chip.gold { background: rgba(251,199,104,0.22); color: #5a4310; }
        .ms-section-chip.red { background: rgba(225,101,64,0.14); color: #88321a; }
        .ms-section-chip.indigo { background: rgba(50,142,250,0.10); color: var(--color-deep-indigo, #3a5fb1); }
        .ms-section-chip.muted { background: rgba(17,17,17,0.05); color: var(--color-muted-ash); }

        /* ─── Manuscript body ───────────────────────────────────── */
        .ms-body {
          font-family: 'Iowan Old Style', 'Charter', Georgia, serif;
          font-size: 18px;
          line-height: 1.78;
          color: var(--color-midnight-ink);
          margin: 0;
        }

        /* ─── Inline edit marks (manuscript) ─────────────────────
           No buttons in the manuscript — just visual marks that
           anchor to a card in the rail. Hovering or clicking a
           mark activates its card. */
        .ms-edit-anchor {
          cursor: pointer;
          transition: background-color 120ms ease;
        }
        .ms-edit-anchor.is-active {
          outline: 2px solid rgba(50,142,250,0.45);
          outline-offset: 2px;
          border-radius: 2px;
        }
        .ms-cut.pending {
          color: rgba(17,17,17,0.55);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          background: rgba(225,101,64,0.06);
          border-radius: 3px;
          padding: 0 2px;
        }
        .ms-cut.accepted {
          color: rgba(17,17,17,0.32);
          text-decoration: line-through;
          text-decoration-color: rgba(17,17,17,0.18);
          text-decoration-thickness: 1px;
        }
        .ms-rephrase-old.pending {
          color: rgba(17,17,17,0.55);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.55);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ms-rephrase-new.pending {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 4px;
        }
        .ms-rephrase-new.accepted {
          color: var(--color-midnight-ink);
        }
        /* Defensive rephrase inline: don't render a strikethrough or
           swap. Render the script text plain with a soft underline
           that says "this is flagged but stays as written." */
        .ms-rephrase-keep {
          background: rgba(71, 208, 150, 0.08);
          border-radius: 2px;
          padding: 0 2px;
          text-decoration: underline;
          text-decoration-color: rgba(71, 208, 150, 0.6);
          text-decoration-style: dotted;
          text-underline-offset: 4px;
        }
        .ms-adopt.pending {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 0 4px;
          font-style: italic;
        }
        .ms-adopt.pending::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
          margin-right: 2px;
        }
        .ms-adopt.accepted {
          color: var(--color-midnight-ink);
          font-style: italic;
        }
        .ms-adopt.accepted::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.4;
        }

        /* ─── Speaker layer ─────────────────────────────────────── */
        .ms-spoken-skipped {
          color: rgba(17,17,17,0.4);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .ms-spoken-paraphrase-old {
          color: rgba(17,17,17,0.45);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          margin-right: 4px;
        }
        .ms-spoken-paraphrase-new {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 3px;
        }
        .ms-spoken-improv {
          background: rgba(50,142,250,0.10);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 0 3px;
          font-style: italic;
        }
        .ms-spoken-improv::before {
          content: "+ ";
          font-style: normal;
          opacity: 0.55;
        }

        /* ─── Comments rail ─────────────────────────────────────── */
        .ms-rail {
          /* On wide screens the rail sits beside the manuscript and
             scrolls independently with the page. We keep it
             non-sticky so its top aligns with the manuscript top —
             feels more like Google Docs comments than a sidebar. */
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-top: 64px; /* matches the height of the sticky toggle */
        }
        @media (max-width: 1099px) {
          .ms-rail { padding-top: 12px; }
        }

        .ms-rail-empty {
          padding: 20px;
          font-size: 13px;
          color: var(--color-muted-ash);
          font-style: italic;
          text-align: center;
          border: 1px dashed rgba(17,17,17,0.12);
          border-radius: 8px;
        }
        .ms-rail-heading {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: var(--color-midnight-ink);
          margin: 0 0 4px;
        }
        /* Two groups in the rail: Script edits + Delivery notes. The
           outer .ms-rail uses gap: 12px between cards; we want a
           bigger break BETWEEN groups so the eye sees two columns of
           content, not one. */
        .ms-rail-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ms-rail-group + .ms-rail-group {
          margin-top: 28px;
          padding-top: 20px;
          border-top: 1px solid rgba(17,17,17,0.08);
        }
        .ms-rail-subhead {
          font-size: 12px;
          line-height: 1.45;
          color: var(--color-muted-ash);
          margin: 0 0 8px;
          font-family: 'Inter', sans-serif;
        }

        /* ─── Edit card ─────────────────────────────────────────── */
        .ms-card {
          background: var(--color-canvas-white);
          border: 1px solid rgba(17,17,17,0.10);
          border-radius: 10px;
          padding: 14px 16px;
          transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
          scroll-margin-top: 80px; /* don't hide behind the toggle on scroll */
        }
        .ms-card.is-active {
          border-color: rgba(50,142,250,0.45);
          box-shadow: 0 0 0 3px rgba(50,142,250,0.10);
        }
        .ms-card.is-accepted {
          background: rgba(71, 208, 150, 0.04);
          border-color: rgba(71, 208, 150, 0.24);
        }
        .ms-card.is-rejected {
          opacity: 0.55;
        }
        .ms-card-meta {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--color-muted-ash);
          margin-bottom: 8px;
        }
        .ms-card-meta strong { font-weight: 600; }
        .ms-card-meta strong.cut { color: #88321a; }
        .ms-card-meta strong.adopt { color: var(--color-deep-indigo); }
        .ms-card-meta strong.rephrase { color: #5a4310; }
        .ms-card-meta strong.drill { color: #1a4f88; }
        .ms-card-meta strong.observation { color: var(--color-muted-ash); font-weight: 500; }

        /* Defensive rephrase: the script's wording is the recommended
           text — render it as the "winner," with the spoken version
           as a small aside underneath. */
        .ms-card-redline.rephrase-keep {
          background: rgba(71, 208, 150, 0.10);
          color: var(--color-midnight-ink);
          border-radius: 3px;
          padding: 1px 6px;
          display: inline-block;
        }
        .ms-card-spoken-aside {
          display: block;
          margin-top: 8px;
          font-size: 12.5px;
          color: var(--color-muted-ash);
          font-style: italic;
        }
        .ms-card-spoken-aside::before {
          content: "";
        }

        /* Observation card: same shell, quieter. */
        .ms-card-observation {
          border-style: dashed;
          background: rgba(17,17,17,0.015);
        }
        .ms-card-observation-label {
          font-size: 12.5px;
          color: var(--color-midnight-ink);
          margin: 0;
          font-weight: 500;
        }
        /* Paraphrase line in an observation card: serif body text,
           same family as the manuscript. Only the actually-changed
           words get visual treatment — equal words flow plain. */
        .ms-card-paraphrase {
          font-family: var(--font-script);
          font-size: 14.5px;
          line-height: 1.6;
          color: var(--color-midnight-ink);
          margin: 0;
        }
        .ms-card-paraphrase-del {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          margin-right: 2px;
        }
        .ms-card-paraphrase-ins {
          background: rgba(251,199,104,0.32);
          color: #4a3508;
          border-radius: 3px;
          padding: 0 3px;
        }

        .ms-card-redline {
          font-family: var(--font-script);
          font-size: 14.5px;
          line-height: 1.55;
          margin: 0;
        }
        .ms-card-redline.cut {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
        }
        .ms-card-redline.rephrase-old {
          color: rgba(17,17,17,0.5);
          text-decoration: line-through;
          text-decoration-color: rgba(225,101,64,0.5);
          text-decoration-thickness: 1.5px;
          display: block;
        }
        .ms-card-redline.rephrase-new {
          background: rgba(251,199,104,0.28);
          color: #4a3508;
          border-radius: 3px;
          padding: 1px 6px;
          display: inline-block;
          margin-top: 4px;
        }
        .ms-card-redline.adopt {
          background: rgba(50,142,250,0.08);
          color: var(--color-deep-indigo, #3a5fb1);
          border-radius: 3px;
          padding: 1px 6px;
          display: inline-block;
          font-style: italic;
          margin-top: 6px;
        }
        /* Adopt anchor preview — shows the script line that the new
           text follows. Quiet, plain serif, smaller than the redline. */
        .ms-card-anchor {
          font-family: var(--font-script);
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-muted-ash);
          margin: 0 0 6px;
        }
        .ms-card-redline.drill {
          color: var(--color-midnight-ink);
          padding-left: 10px;
          border-left: 2px solid rgba(26, 79, 136, 0.4);
        }
        .ms-card-reason {
          margin-top: 10px;
          font-size: 12.5px;
          line-height: 1.5;
          color: rgba(17,17,17,0.7);
          font-family: 'Inter', sans-serif;
        }
        .ms-card-tactic {
          margin-top: 8px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-midnight-ink);
          font-family: 'Inter', sans-serif;
        }
        .ms-card-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
        }
        .ms-card-btn {
          appearance: none;
          background: transparent;
          border: 1px solid rgba(17,17,17,0.18);
          color: var(--color-midnight-ink);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease;
        }
        .ms-card-btn:hover {
          background: var(--color-whisper-gray, rgba(17,17,17,0.04));
        }
        .ms-card-btn.is-accept-active {
          background: var(--color-midnight-ink);
          color: var(--color-canvas-white);
          border-color: var(--color-midnight-ink);
        }
        .ms-card-btn.is-reject-active {
          background: rgba(225,101,64,0.10);
          border-color: rgba(225,101,64,0.45);
          color: #88321a;
        }
        .ms-card-btn.is-drill {
          color: var(--color-deep-indigo, #3a5fb1);
          border-color: rgba(50,142,250,0.32);
        }
        .ms-card-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ─── Sticky action bar ─────────────────────────────────── */
        .ms-bar {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          z-index: 20;
          background: var(--color-canvas-white);
          border-top: 1px solid rgba(17,17,17,0.08);
          padding: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px));
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          box-shadow: 0 -2px 16px rgba(17,17,17,0.04);
        }
        .ms-bar-inner {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          max-width: 1140px;
        }
        .ms-bar-count {
          font-size: 13px;
          color: var(--color-muted-ash);
          flex: 1;
        }
        .ms-bar-count strong {
          color: var(--color-midnight-ink);
          font-weight: 500;
        }
        .ms-bar-error {
          font-size: 12.5px;
          color: var(--color-leadgen-red, #e16540);
          margin-right: 8px;
        }
      `}</style>

      <div className={`ms-grid ${showRail ? "has-rail" : ""}`}>
        {/* ─── Left column: manuscript ─────────────────────────── */}
        <div>
          {/* Tabs — mode-aware.
              With-script reports keep the editorial labels (Coach
              edits / What you said / Both).
              Freestyle reports collapse to a two-state Layered /
              Side-by-side toggle. Internally Layered uses the "coach"
              view mode and Side-by-side uses "both" — they're the
              same state machine, different presentation. */}
          <div className="ms-toggle" role="tablist" aria-label="View">
            {mode === "freestyle" ? (
              <>
                <button
                  role="tab"
                  aria-selected={viewMode === "coach"}
                  className="ms-toggle-pill"
                  onClick={() => setViewMode("coach")}
                >
                  Layered
                </button>
                <button
                  role="tab"
                  aria-selected={viewMode === "both"}
                  className="ms-toggle-pill"
                  onClick={() => setViewMode("both")}
                >
                  Side-by-side
                </button>
              </>
            ) : (
              <>
                <button
                  role="tab"
                  aria-selected={viewMode === "coach"}
                  className="ms-toggle-pill"
                  onClick={() => setViewMode("coach")}
                >
                  Coach edits
                </button>
                <button
                  role="tab"
                  aria-selected={viewMode === "spoken"}
                  className="ms-toggle-pill"
                  onClick={() => setViewMode("spoken")}
                >
                  What you said
                </button>
                <button
                  role="tab"
                  aria-selected={viewMode === "both"}
                  className="ms-toggle-pill"
                  onClick={() => setViewMode("both")}
                >
                  Both
                </button>
              </>
            )}
            <span className="ms-toggle-spacer" />
            <span className="ms-toggle-meta">
              {viewMode === "coach"
                ? mode === "freestyle"
                  ? "Script with what you said layered on top"
                  : `${acceptedEdits.length} of ${scriptEditItems.length} script edits accepted`
                : viewMode === "spoken"
                ? "How your delivery diverged"
                : mode === "freestyle"
                ? "Script and transcript side-by-side for line-by-line comparison"
                : "Coach + speaker layers overlaid"}
            </span>
          </div>

          {sections.map((section) => {
            const sectionEdits = editsBySection.get(section.id) ?? [];
            const inlineEdits = sectionEdits.filter((e) => e.kind !== "drill");

            // Freestyle's primary "Layered" view gets the inline
            // word-level diff treatment — script as spine with
            // strikethrough + highlight where the speaker swapped
            // words. The Side-by-side view falls through to the
            // standard "both" manuscript layout below.
            if (mode === "freestyle" && viewMode === "coach") {
              return (
                <LayeredSection
                  key={section.id}
                  speechId={speechId}
                  section={section}
                  diffRows={diffRows}
                  isWorst={section.id === worstSectionId}
                />
              );
            }

            const showCoach = viewMode === "coach" || viewMode === "both";
            const showSpoken = viewMode === "spoken" || viewMode === "both";
            const coachTokens = showCoach
              ? tokeniseCoachEdits(section.body, inlineEdits)
              : null;
            const spokenTokens = showSpoken
              ? tokeniseSpokenDeviations(diffRows, section.id)
              : null;

            return (
              <section key={section.id} className="ms-section">
                <header className="ms-section-head">
                  <span className="ms-section-name">{section.name}</span>
                  <SectionChip section={section} mode={mode} />
                </header>

                {coachTokens && (
                  <p className="ms-body">
                    {coachTokens.length === 0 ? (
                      <span>{section.body}</span>
                    ) : (
                      coachTokens.map((tok, i) => (
                        <CoachTokenSpan
                          key={i}
                          token={tok}
                          acceptance={acceptance}
                          activeEditId={activeEditId}
                          onActivate={(id) => activateEdit(id, "manuscript")}
                          setAnchorRef={setAnchorRef}
                        />
                      ))
                    )}
                  </p>
                )}

                {spokenTokens && (
                  <p
                    className="ms-body"
                    style={
                      viewMode === "both"
                        ? {
                            marginTop: 12,
                            paddingTop: 12,
                            borderTop: "1px dashed rgba(17,17,17,0.10)",
                            fontSize: 16,
                            color: "rgba(17,17,17,0.78)",
                          }
                        : undefined
                    }
                  >
                    {viewMode === "both" && (
                      <span
                        style={{
                          display: "block",
                          fontFamily: "Inter, sans-serif",
                          fontSize: 11,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--color-muted-ash)",
                          marginBottom: 6,
                        }}
                      >
                        What you said
                      </span>
                    )}
                    {spokenTokens.length === 0 ? (
                      <span style={{ color: "var(--color-muted-ash)", fontStyle: "italic" }}>
                        — this section wasn&rsquo;t reached —
                      </span>
                    ) : (
                      spokenTokens.map((tok, i) => <SpokenTokenSpan key={i} token={tok} />)
                    )}
                  </p>
                )}
              </section>
            );
          })}

          {sections.length === 0 && (
            <p
              style={{
                color: "var(--color-muted-ash)",
                fontStyle: "italic",
                padding: "32px 0",
              }}
            >
              No sections to display.
            </p>
          )}
        </div>

        {/* ─── Right column: comments rail ─────────────────────────
             Split into two groups so the user knows what each card
             is for. Script edits are proposed changes to the script
             (Accept/Reject; the only thing the Apply button cares
             about). Delivery notes are observations and practice
             suggestions about how the user delivered (no Apply,
             only Drill on drill cards). */}
        {showRail && (
          <aside className="ms-rail" aria-label="Coach feedback">
            {scriptEditItems.length > 0 && (
              <div className="ms-rail-group">
                <h3 className="ms-rail-heading">Script edits</h3>
                <p className="ms-rail-subhead">
                  Changes to your script. Apply the ones you want.
                </p>
                {scriptEditItems.map((item) => (
                  <EditCard
                    key={item.edit.id}
                    edit={item.edit}
                    sectionName={
                      sections.find((s) => s.id === item.edit.section_id)?.name ??
                      "Section"
                    }
                    state={acceptance.get(item.edit.id) ?? "pending"}
                    isActive={activeEditId === item.edit.id}
                    onSetState={(s) => setEdit(item.edit.id, s)}
                    onActivate={() => activateEdit(item.edit.id, "rail")}
                    onDrill={() => startDrill(item.edit.id)}
                    drillPending={pending}
                    setCardRef={setCardRef}
                  />
                ))}
              </div>
            )}

            {deliveryNoteItems.length > 0 && (
              <div className="ms-rail-group">
                <h3 className="ms-rail-heading">Delivery notes</h3>
                <p className="ms-rail-subhead">
                  Observations on how you delivered. No script changes.
                </p>
                {deliveryNoteItems.map((item) =>
                  item.kind === "edit" ? (
                    <EditCard
                      key={item.edit.id}
                      edit={item.edit}
                      sectionName={
                        sections.find((s) => s.id === item.edit.section_id)?.name ??
                        "Section"
                      }
                      state={acceptance.get(item.edit.id) ?? "pending"}
                      isActive={activeEditId === item.edit.id}
                      onSetState={(s) => setEdit(item.edit.id, s)}
                      onActivate={() => activateEdit(item.edit.id, "rail")}
                      onDrill={() => startDrill(item.edit.id)}
                      drillPending={pending}
                      setCardRef={setCardRef}
                    />
                  ) : (
                    <ObservationCard
                      key={item.id}
                      observation={item}
                      sectionName={
                        sections.find((s) => s.id === item.sectionId)?.name ??
                        "Section"
                      }
                    />
                  ),
                )}
              </div>
            )}

            {scriptEditItems.length === 0 && deliveryNoteItems.length === 0 && (
              <div className="ms-rail-empty">No coach feedback for this take.</div>
            )}
          </aside>
        )}
      </div>

      {/* ─── Sticky action bar ─────────────────────────────────── */}
      <div className="ms-bar">
        <div className="ms-bar-inner">
          <span className="ms-bar-count">
            {/* Freestyle reports rarely have edits to accept; the
                "No edits accepted yet" copy is editorial framing that
                doesn't apply when the user is memorizing. We hide it
                on freestyle and only surface the count when edits
                exist (e.g. a defensive rephrase). */}
            {mode === "freestyle" && acceptedEdits.length === 0
              ? null
              : acceptedEdits.length === 0
              ? `No edits accepted yet`
              : `${acceptedEdits.length} ${
                  acceptedEdits.length === 1 ? "edit" : "edits"
                } accepted`}
          </span>
          {error && <span className="ms-bar-error">{error}</span>}
          {acceptedEdits.length > 0 && (
            <button
              type="button"
              onClick={applyOnly}
              disabled={pending}
              className="btn-light"
              style={{ fontSize: 13 }}
            >
              Apply to script only
            </button>
          )}
          <button
            type="button"
            onClick={applyAndRecord}
            disabled={pending}
            className="btn-primary"
            style={{ padding: "11px 20px", fontSize: 14 }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Manuscript token renderers ──────────────────────────────────────

function CoachTokenSpan({
  token,
  acceptance,
  activeEditId,
  onActivate,
  setAnchorRef,
}: {
  token: Token;
  acceptance: Map<string, AcceptanceState>;
  activeEditId: string | null;
  onActivate: (id: string) => void;
  setAnchorRef: (id: string, el: HTMLElement | null) => void;
}) {
  if (token.kind === "text") return <span>{token.text}</span>;
  if (token.kind !== "coach-edit") return null;

  const { edit, original } = token;
  const state = acceptance.get(edit.id) ?? "pending";

  // Rejected: hide the change. Show the original text plain (for cut/
  // rephrase) or nothing (for adopt). No anchor — there's nothing to
  // point to.
  if (state === "rejected") {
    if (edit.kind === "cut" || edit.kind === "rephrase") {
      return <span>{original}</span>;
    }
    return null;
  }

  const isActive = activeEditId === edit.id;
  const stateClass = state === "accepted" ? "accepted" : "pending";
  const activeClass = isActive ? " is-active" : "";

  if (edit.kind === "cut") {
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor ms-cut ${stateClass}${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {original}
      </span>
    );
  }
  if (edit.kind === "rephrase") {
    // Defensive rephrase: render the script's original text with a
    // soft "flagged" underline. The coach is saying keep this; we
    // don't want to render the spoken alternative as if it were a
    // proposed swap. (state === "rejected" was already handled
    // higher up — that path renders the plain original.)
    if (isDefensiveRephrase(edit.reason)) {
      return (
        <span
          ref={(el) => setAnchorRef(edit.id, el)}
          className={`ms-edit-anchor ms-rephrase-keep${activeClass}`}
          onClick={() => onActivate(edit.id)}
          onMouseEnter={() => onActivate(edit.id)}
        >
          {original}
        </span>
      );
    }
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {state === "pending" && (
          <span className={`ms-rephrase-old ${stateClass}`}>{original}</span>
        )}
        <span className={`ms-rephrase-new ${stateClass}`}>{edit.after}</span>
      </span>
    );
  }
  if (edit.kind === "adopt") {
    const insertionText = adoptInsertionFor(edit);
    if (!insertionText) return null;
    return (
      <span
        ref={(el) => setAnchorRef(edit.id, el)}
        className={`ms-edit-anchor${activeClass}`}
        onClick={() => onActivate(edit.id)}
        onMouseEnter={() => onActivate(edit.id)}
      >
        {" "}
        <span className={`ms-adopt ${stateClass}`}>{insertionText}</span>
      </span>
    );
  }
  return null;
}

function SpokenTokenSpan({ token }: { token: Token }) {
  if (token.kind === "text") return <span>{token.text}</span>;
  if (token.kind === "speaker-skipped") {
    return <span className="ms-spoken-skipped">{token.text}</span>;
  }
  if (token.kind === "speaker-improv") {
    return <span className="ms-spoken-improv">{token.spoken}</span>;
  }
  if (token.kind === "speaker-paraphrase") {
    return (
      <>
        {token.ops.map((op, i) => {
          if (op.kind === "equal") return <span key={i}>{op.text} </span>;
          if (op.kind === "del") {
            return (
              <span key={i} className="ms-spoken-paraphrase-old">
                {op.written}{" "}
              </span>
            );
          }
          if (op.kind === "ins") {
            return (
              <span key={i} className="ms-spoken-paraphrase-new">
                {op.spoken}{" "}
              </span>
            );
          }
          return (
            <span key={i}>
              <span className="ms-spoken-paraphrase-old">{op.written}</span>
              <span className="ms-spoken-paraphrase-new">{op.spoken}</span>{" "}
            </span>
          );
        })}
      </>
    );
  }
  return null;
}

// ─── Rail card ───────────────────────────────────────────────────────

function EditCard({
  edit,
  sectionName,
  state,
  isActive,
  onSetState,
  onActivate,
  onDrill,
  drillPending,
  setCardRef,
}: {
  edit: SuggestedEdit;
  sectionName: string;
  state: AcceptanceState;
  isActive: boolean;
  onSetState: (s: AcceptanceState) => void;
  onActivate: () => void;
  onDrill: () => void;
  drillPending: boolean;
  setCardRef: (id: string, el: HTMLElement | null) => void;
}) {
  const kindLabel: Record<SuggestedEdit["kind"], string> = {
    cut: "Cut",
    adopt: "Adopt",
    rephrase: "Rephrase",
    drill: "Drill",
  };
  const stateClass =
    state === "accepted"
      ? "is-accepted"
      : state === "rejected"
      ? "is-rejected"
      : "";

  return (
    <div
      ref={(el) => setCardRef(edit.id, el)}
      className={`ms-card ${stateClass}${isActive ? " is-active" : ""}`}
      onMouseEnter={() => onActivate()}
      onClick={() => onActivate()}
    >
      <div className="ms-card-meta">
        <strong className={edit.kind}>{kindLabel[edit.kind]}</strong>
        <span aria-hidden="true">·</span>
        <span>{sectionName}</span>
      </div>

      {edit.kind === "cut" && edit.before && (
        <p className="ms-card-redline cut">&ldquo;{edit.before}&rdquo;</p>
      )}
      {edit.kind === "adopt" && (() => {
        const insertionText = adoptInsertionFor(edit);
        if (!insertionText) return null;
        return (
          <>
            {/* If the coach gave us an anchor, show it as a quiet
                "after this line:" reference so the user knows where in
                the script the addition lands. The actual new text is
                the highlighted bit underneath. */}
            {edit.before && (
              <p className="ms-card-anchor">After: &ldquo;{edit.before}&rdquo;</p>
            )}
            <p className="ms-card-redline adopt">&ldquo;{insertionText}&rdquo;</p>
          </>
        );
      })()}
      {edit.kind === "rephrase" && (
        <>
          {/* Defensive rephrase: coach is recommending KEEP THE SCRIPT.
              Render the script version as the "winning" text (not
              struck through) and the spoken version as a small "you
              said" annotation, so the visual matches the prose intent.
              Otherwise show a word-level inline diff so only the
              actually-changed words are highlighted — matches the
              treatment of paraphrase observations. */}
          {isDefensiveRephrase(edit.reason) ? (
            <>
              {edit.before && (
                <span className="ms-card-redline rephrase-keep">
                  &ldquo;{edit.before}&rdquo;
                </span>
              )}
              {edit.after && (
                <span className="ms-card-spoken-aside">
                  You said: &ldquo;{edit.after}&rdquo;
                </span>
              )}
            </>
          ) : edit.before && edit.after ? (
            <p className="ms-card-paraphrase" style={{ marginTop: 4 }}>
              &ldquo;
              {diffWordsToOps(edit.before, edit.after).map((op, i) => (
                <ObsOpSpan key={i} op={op} />
              ))}
              &rdquo;
            </p>
          ) : (
            <>
              {edit.before && (
                <span className="ms-card-redline rephrase-old">
                  &ldquo;{edit.before}&rdquo;
                </span>
              )}
              {edit.after && (
                <span className="ms-card-redline rephrase-new">
                  &ldquo;{edit.after}&rdquo;
                </span>
              )}
            </>
          )}
        </>
      )}
      {edit.kind === "drill" && edit.line_target && (
        <p className="ms-card-redline drill">&ldquo;{edit.line_target}&rdquo;</p>
      )}

      {edit.kind === "drill" && edit.tactic ? (
        <p className="ms-card-tactic">{edit.tactic}</p>
      ) : (
        edit.reason && <p className="ms-card-reason">{edit.reason}</p>
      )}
      {edit.kind === "drill" && edit.tactic && edit.reason && (
        <p className="ms-card-reason">{edit.reason}</p>
      )}

      <div className="ms-card-actions">
        {edit.kind === "drill" ? (
          <button
            type="button"
            className="ms-card-btn is-drill"
            onClick={(e) => {
              e.stopPropagation();
              onDrill();
            }}
            disabled={drillPending}
          >
            Drill →
          </button>
        ) : edit.kind === "rephrase" && isDefensiveRephrase(edit.reason) ? (
          // Defensive rephrase = coach saying "keep the script."
          // There's no script change to apply, so the only meaningful
          // action is to acknowledge by leaving the script alone.
          // We surface a single, quiet "Keep as written" action that
          // dismisses the card without committing anything; the
          // sticky-footer apply count won't include this edit.
          <button
            type="button"
            className={`ms-card-btn${state === "rejected" ? " is-reject-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              // Mark as rejected (= "make no change to the script") so
              // it doesn't get included in apply, and dim the card.
              onSetState(state === "rejected" ? "pending" : "rejected");
            }}
          >
            {state === "rejected" ? "Kept as written" : "Keep as written"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`ms-card-btn${state === "accepted" ? " is-accept-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetState(state === "accepted" ? "pending" : "accepted");
              }}
            >
              {state === "accepted" ? "Accepted" : "Accept"}
            </button>
            <button
              type="button"
              className={`ms-card-btn${state === "rejected" ? " is-reject-active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetState(state === "rejected" ? "pending" : "rejected");
              }}
            >
              {state === "rejected" ? "Rejected" : "Reject"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Observation card (informational, no actions) ────────────────────
//
// Surfaces speaker deviations the coach didn't address. No buttons —
// the user just needs to know they happened. "You skipped this line"
// or "You phrased this differently."
//
// Paraphrase observations render the row's WordOp[] inline so only
// the actually-changed words are highlighted. A skipped observation
// shows the missed script text with a strikethrough and no spoken
// counterpart.

function ObservationCard({
  observation,
  sectionName,
}: {
  observation: ObservationItem;
  sectionName: string;
}) {
  const label =
    observation.deviation === "skipped"
      ? "You skipped this"
      : "You phrased this differently";
  return (
    <div className="ms-card ms-card-observation">
      <div className="ms-card-meta">
        <strong className="observation">Note</strong>
        <span aria-hidden="true">·</span>
        <span>{sectionName}</span>
      </div>
      <p className="ms-card-observation-label">{label}</p>
      {observation.deviation === "skipped" ? (
        <p
          className="ms-card-redline cut"
          style={{ marginTop: 4 }}
        >
          &ldquo;{observation.written}&rdquo;
        </p>
      ) : (
        <p className="ms-card-paraphrase" style={{ marginTop: 4 }}>
          {observation.ops.map((op, i) => (
            <ObsOpSpan key={i} op={op} />
          ))}
        </p>
      )}
    </div>
  );
}

// Inline track-changes for a single paraphrase op. Equal words flow as
// plain body text; subs render the script word struck-through inline
// with the spoken word highlighted next to it; pure dels strike the
// script word; pure ins highlight the spoken word.
function ObsOpSpan({ op }: { op: WordOp }) {
  if (op.kind === "equal") return <span>{op.text} </span>;
  if (op.kind === "del") {
    return (
      <span className="ms-card-paraphrase-del">{op.written} </span>
    );
  }
  if (op.kind === "ins") {
    return (
      <span className="ms-card-paraphrase-ins">{op.spoken} </span>
    );
  }
  // sub
  return (
    <span>
      <span className="ms-card-paraphrase-del">{op.written}</span>
      <span className="ms-card-paraphrase-ins">{op.spoken}</span>{" "}
    </span>
  );
}

function SectionChip({
  section,
  mode,
}: {
  section: SectionInput;
  mode: SessionMode;
}) {
  if (mode === "freestyle" && section.memoryBand) {
    const band = section.memoryBand;
    const label =
      band === "word-perfect"
        ? "word-perfect"
        : band === "mostly-there"
        ? "mostly there"
        : band === "rough"
        ? "rough — drill this"
        : band === "blank"
        ? "blanked"
        : "not reached";
    const color =
      band === "word-perfect"
        ? "green"
        : band === "mostly-there"
        ? "indigo"
        : band === "rough"
        ? "gold"
        : band === "blank"
        ? "red"
        : "muted";
    return <span className={`ms-section-chip ${color}`}>{label}</span>;
  }
  if (section.pacing) {
    const { actualSeconds, targetSeconds, deltaSeconds } = section.pacing;
    const sign = deltaSeconds > 0 ? "+" : deltaSeconds < 0 ? "−" : "";
    const abs = Math.abs(deltaSeconds);
    const color =
      Math.abs(deltaSeconds) <= 5
        ? "green"
        : deltaSeconds > 0
        ? "red"
        : "gold";
    return (
      <span className={`ms-section-chip ${color}`}>
        {fmtSec(actualSeconds)} / {fmtSec(targetSeconds)} · {sign}
        {abs}s
      </span>
    );
  }
  return null;
}

function fmtSec(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// ─── Band palette ────────────────────────────────────────────────────
//
// Shared palette for the per-section recall band — the section's
// LayeredSection card uses these for the band rail (left border),
// chip background/border/text, and matching states. The colors reuse
// the pacing pills' palette so the page reads consistently.

const BAND_COLORS: Record<
  NonNullable<SectionInput["memoryBand"]>,
  { fill: string; stroke: string; text: string; label: string }
> = {
  "word-perfect": {
    fill: "rgba(70,182,141,0.16)",
    stroke: "rgba(70,182,141,0.42)",
    text: "var(--color-deliver-green, #2c8c61)",
    label: "Word-perfect",
  },
  "mostly-there": {
    fill: "rgba(70,182,141,0.08)",
    stroke: "rgba(70,182,141,0.28)",
    text: "var(--color-deliver-green, #2c8c61)",
    label: "Mostly there",
  },
  rough: {
    fill: "rgba(232,182,77,0.16)",
    stroke: "rgba(232,182,77,0.42)",
    text: "var(--color-engagement-gold, #a37413)",
    label: "Rough",
  },
  blank: {
    fill: "rgba(225,101,64,0.12)",
    stroke: "rgba(225,101,64,0.36)",
    text: "var(--color-leadgen-red, #c44a26)",
    label: "Blanked",
  },
  "not-reached": {
    fill: "rgba(17,17,17,0.04)",
    stroke: "rgba(17,17,17,0.10)",
    text: "var(--color-muted-ash, #6e6e72)",
    label: "Not reached",
  },
};

// ─── Layered diff (default freestyle view) ──────────────────────────
//
// One paragraph per section, script-as-spine, with inline word-level
// strikethrough + highlight where the speaker swapped words. The
// rendering reuses the existing speaker-layer CSS (ms-spoken-*) so
// blanked words read struck-and-faded, paraphrased words read
// gold-highlighted next to their struck script counterparts.
//
// Per band:
//   word-perfect       → clean script paragraph
//   mostly-there       → script with inline swap pairs
//   rough              → spoken text + "switch to side-by-side" tip
//                        (heavy paraphrase doesn't fit inline diffs)
//   blank              → "— SILENT —" chip + entire script struck
//   not-reached        → script in italic, dimmed, "didn't get here" tag

function paraphraseCount(diffRows: DiffRow[], sectionId: string): number {
  let n = 0;
  for (const row of diffRows) {
    if (row.sectionId !== sectionId) continue;
    if (row.kind !== "paraphrase") continue;
    // Each paraphrase row may contain several substitutions; count
    // only the "real" word swaps (sub or del+ins pairs).
    for (const op of row.ops) {
      if (op.kind === "sub" || op.kind === "ins" || op.kind === "del") n += 1;
    }
  }
  return n;
}

// Spoken text reconstruction for rough sections — pulls everything the
// speaker said in this section out of the diff rows.
function reconstructSpoken(diffRows: DiffRow[], sectionId: string): string {
  const parts: string[] = [];
  for (const row of diffRows) {
    if (row.sectionId !== sectionId) continue;
    if (row.kind === "match") parts.push(row.spoken);
    else if (row.kind === "improv") parts.push(row.spoken);
    else if (row.kind === "paraphrase") {
      for (const op of row.ops) {
        if (op.kind === "equal") parts.push(op.text);
        else if (op.kind === "ins" || op.kind === "sub") parts.push(op.spoken);
      }
    }
  }
  return parts.join(" ").trim();
}

function LayeredSection({
  speechId,
  section,
  diffRows,
  isWorst,
}: {
  speechId: string;
  section: SectionInput;
  diffRows: DiffRow[];
  isWorst: boolean;
}) {
  const band = section.memoryBand ?? "not-reached";
  const colors = BAND_COLORS[band];
  const recallPctText =
    typeof section.recallPct === "number"
      ? `${Math.round(section.recallPct * 100)}%`
      : null;
  const paraCount = paraphraseCount(diffRows, section.id);
  const drillHref = `/app/speeches/${speechId}/record?mode=freestyle&section=${section.id}`;

  return (
    <section
      id={`section-${section.id}`}
      className="ms-section ms-layered-section"
      style={{
        borderLeft: `3px solid ${colors.stroke}`,
        paddingLeft: 16,
        marginLeft: -16,
      }}
    >
      <header
        className="ms-section-head"
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      >
        <span className="ms-section-name">{section.name}</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 10px",
            borderRadius: 999,
            background: colors.fill,
            border: `1px solid ${colors.stroke}`,
            color: colors.text,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {colors.label}
          {recallPctText ? ` · ${recallPctText}` : ""}
        </span>
        {paraCount > 0 && band !== "rough" && band !== "blank" && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 10px",
              borderRadius: 999,
              background: "rgba(232,182,77,0.14)",
              color: "#a37413",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {paraCount} {paraCount === 1 ? "paraphrase" : "paraphrases"}
          </span>
        )}
        {band === "rough" && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 10px",
              borderRadius: 999,
              background: "rgba(17,17,17,0.04)",
              color: "var(--color-muted-ash)",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            Heavily paraphrased
          </span>
        )}
        {section.hadLongPause && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--color-muted-ash)",
            }}
            title="You paused for more than 4 seconds in this section"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="2" y="1.5" width="2" height="7" rx="0.5" fill="currentColor" />
              <rect x="6" y="1.5" width="2" height="7" rx="0.5" fill="currentColor" />
            </svg>
            Long pause
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Link
          href={drillHref}
          className={isWorst ? "btn-primary" : "btn-light"}
          style={{
            fontSize: 12,
            padding: isWorst ? "5px 12px" : "4px 10px",
          }}
        >
          {isWorst ? "Drill this section →" : "Drill this section"}
        </Link>
      </header>

      <LayeredBody section={section} diffRows={diffRows} band={band} />
    </section>
  );
}

function LayeredBody({
  section,
  diffRows,
  band,
}: {
  section: SectionInput;
  diffRows: DiffRow[];
  band: NonNullable<SectionInput["memoryBand"]>;
}) {
  // Word-perfect: just render the script. No annotations needed.
  if (band === "word-perfect") {
    return <p className="ms-body">{section.body}</p>;
  }

  // Mostly-there: render the script with inline word-level swaps from
  // paraphrase rows. Walk the diff rows in order; each row produces
  // either plain text (match) or a sequence of word-level spans that
  // mix struck-script + highlighted-spoken (paraphrase).
  if (band === "mostly-there") {
    const rows = diffRows.filter((r) => r.sectionId === section.id);
    return (
      <p className="ms-body">
        {rows.map((row, i) => {
          if (row.kind === "match") {
            return <span key={i}>{row.written} </span>;
          }
          if (row.kind === "skipped") {
            return (
              <span key={i} className="ms-spoken-skipped">
                {row.written}{" "}
              </span>
            );
          }
          if (row.kind === "paraphrase") {
            return (
              <span key={i}>
                {row.ops.map((op, j) => {
                  if (op.kind === "equal") return <span key={j}>{op.text} </span>;
                  if (op.kind === "del") {
                    return (
                      <span key={j} className="ms-spoken-paraphrase-old">
                        {op.written}{" "}
                      </span>
                    );
                  }
                  if (op.kind === "ins") {
                    return (
                      <span key={j} className="ms-spoken-paraphrase-new">
                        {op.spoken}{" "}
                      </span>
                    );
                  }
                  return (
                    <span key={j}>
                      <span className="ms-spoken-paraphrase-old">
                        {op.written}
                      </span>
                      <span className="ms-spoken-paraphrase-new">
                        {op.spoken}
                      </span>{" "}
                    </span>
                  );
                })}
              </span>
            );
          }
          return null;
        })}
      </p>
    );
  }

  // Rough: too many word swaps to inline-diff cleanly. Show what they
  // said, with a tip that side-by-side is the better view here.
  if (band === "rough") {
    const spoken = reconstructSpoken(diffRows, section.id);
    return (
      <>
        <p className="ms-body">
          {spoken || section.spokenSnippet || section.body}
        </p>
        <p
          style={{
            marginTop: 6,
            fontFamily: "Inter, sans-serif",
            fontSize: 12,
            color: "var(--color-muted-ash)",
            fontStyle: "italic",
          }}
        >
          close to script — switch to side-by-side to compare line by line
        </p>
      </>
    );
  }

  // Blank: red "— SILENT —" chip at the start of the line, followed
  // by the entire script struck-through and faded. Reads as "you
  // said nothing; here's the line you owe yourself."
  if (band === "blank") {
    return (
      <p className="ms-body">
        <span
          style={{
            display: "inline-block",
            padding: "1px 8px",
            marginRight: 8,
            borderRadius: 4,
            background: "rgba(225,101,64,0.12)",
            color: "#c44a26",
            fontFamily: "Inter, sans-serif",
            fontSize: 11,
            fontStyle: "italic",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            verticalAlign: "middle",
          }}
        >
          — silent —
        </span>
        <span className="ms-spoken-skipped">{section.body}</span>
      </p>
    );
  }

  // Not-reached: dimmed script, italic, with a "didn't get here" tag.
  return (
    <p
      className="ms-body"
      style={{ opacity: 0.55, fontStyle: "italic" }}
    >
      <span
        style={{
          display: "inline-block",
          padding: "1px 8px",
          marginRight: 8,
          borderRadius: 4,
          background: "rgba(17,17,17,0.04)",
          color: "var(--color-muted-ash)",
          fontFamily: "Inter, sans-serif",
          fontSize: 11,
          fontStyle: "normal",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          verticalAlign: "middle",
        }}
      >
        didn&rsquo;t get here
      </span>
      <span>{section.body}</span>
    </p>
  );
}

// Pick the worst section to elevate its drill button. Severity ordering
// matches lifecycle.ts: not-reached > blank > rough > mostly-there >
// word-perfect. Ties broken by position (earlier wins).
function pickWorstSectionId(sections: SectionInput[]): string | null {
  const severity: Record<NonNullable<SectionInput["memoryBand"]>, number> = {
    "word-perfect": 0,
    "mostly-there": 1,
    "rough": 2,
    "blank": 3,
    "not-reached": 4,
  };
  let bestId: string | null = null;
  let bestSev = 0;
  for (const s of sections) {
    if (!s.memoryBand) continue;
    const sev = severity[s.memoryBand];
    if (sev > bestSev) {
      bestSev = sev;
      bestId = s.id;
    }
  }
  // Only elevate when the worst section is genuinely weak — drill on a
  // word-perfect section isn't a primary action.
  return bestSev >= 2 ? bestId : null;
}
