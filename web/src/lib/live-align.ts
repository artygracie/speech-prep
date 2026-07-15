// Incremental alignment for the streaming transcription pipe.
//
// The full Needleman–Wunsch in lib/alignment.ts runs O(n*m) on the
// final transcript. While the user is speaking, we don't have the full
// transcript and we can't afford to re-run NW on every word arrival
// either. So we use a much cheaper greedy walker:
//
//   - Maintain a "cursor" into the script (next expected token index).
//   - When a new transcript word lands, look ahead in the script up to
//     a small window (e.g. 12 tokens) for an exact or prefix match.
//   - If we find one, advance the cursor past the match. Tokens we
//     skipped over count as "skipped lines" (we coalesce runs).
//   - If we don't, the word is an improv (off-script) — emit it as a
//     standalone improv token.
//
// This is wrong in some edge cases that NW handles correctly (long
// paraphrases, transposed phrases). We accept that — the post-recording
// alignment pass corrects the record. The live walker just needs to be
// fast and roughly right so the bottom bar feels responsive.

export type ScriptToken = {
  sectionId: string;
  position: number;          // section position
  scriptIdx: number;          // index into the flat script array
  raw: string;
  norm: string;
};

export type LiveEvent =
  | { kind: "match"; sectionId: string; spoken: string; scriptIdx: number; tMs: number }
  | { kind: "paraphrase"; sectionId: string; spoken: string; written: string; scriptIdx: number; tMs: number }
  | { kind: "skipped"; sectionId: string; written: string; scriptIdx: number }
  | { kind: "improv"; sectionId: string | null; spoken: string; tMs: number };

export type LiveState = {
  cursor: number;          // next expected scriptIdx
  events: LiveEvent[];
  // Counts the bottom bar can read directly.
  matched: number;
  paraphrased: number;
  skipped: number;
  improv: number;
  // Where the speaker currently is, by section.
  currentSectionId: string | null;
};

const MAX_LOOKAHEAD = 12;  // how far we'll search for a match
const PREFIX_LEN = 3;       // minimum prefix overlap for a paraphrase match

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function tokeniseScript(
  sections: { id: string; position: number; body: string }[],
): ScriptToken[] {
  const out: ScriptToken[] = [];
  let scriptIdx = 0;
  for (const s of sections) {
    if (!s.body) continue;
    for (const raw of s.body.split(/\s+/)) {
      const norm = normalise(raw);
      if (!norm) continue;
      out.push({
        sectionId: s.id,
        position: s.position,
        scriptIdx,
        raw,
        norm,
      });
      scriptIdx++;
    }
  }
  return out;
}

export function emptyState(scriptTokens: ScriptToken[]): LiveState {
  return {
    cursor: 0,
    events: [],
    matched: 0,
    paraphrased: 0,
    skipped: 0,
    improv: 0,
    currentSectionId: scriptTokens[0]?.sectionId ?? null,
  };
}

// Apply one transcript word. Returns a new state object.
export function ingestWord(
  state: LiveState,
  scriptTokens: ScriptToken[],
  spoken: { word: string; startMs: number; endMs: number },
): LiveState {
  const norm = normalise(spoken.word);
  if (!norm) return state;

  const next = {
    ...state,
    events: state.events.slice(),
  };

  // Search ahead within the lookahead window for a match.
  const end = Math.min(scriptTokens.length, state.cursor + MAX_LOOKAHEAD);
  let matchIdx = -1;
  let matchKind: "exact" | "prefix" | null = null;
  for (let i = state.cursor; i < end; i++) {
    const tok = scriptTokens[i];
    if (tok.norm === norm) {
      matchIdx = i;
      matchKind = "exact";
      break;
    }
    if (
      tok.norm.length >= PREFIX_LEN &&
      norm.length >= PREFIX_LEN &&
      (tok.norm.startsWith(norm.slice(0, PREFIX_LEN)) || norm.startsWith(tok.norm.slice(0, PREFIX_LEN)))
    ) {
      // Save as a fallback but keep looking for an exact further on.
      if (matchIdx === -1) {
        matchIdx = i;
        matchKind = "prefix";
      }
    }
  }

  if (matchIdx === -1) {
    // No script counterpart — improv.
    next.events.push({
      kind: "improv",
      sectionId: next.currentSectionId,
      spoken: spoken.word,
      tMs: spoken.startMs,
    });
    next.improv += 1;
    return next;
  }

  // Tokens between cursor and matchIdx are skipped.
  if (matchIdx > state.cursor) {
    // Coalesce skipped tokens by section.
    const skippedBuckets: { sectionId: string; written: string[]; scriptIdx: number }[] = [];
    for (let i = state.cursor; i < matchIdx; i++) {
      const tok = scriptTokens[i];
      const last = skippedBuckets[skippedBuckets.length - 1];
      if (last && last.sectionId === tok.sectionId) {
        last.written.push(tok.raw);
      } else {
        skippedBuckets.push({
          sectionId: tok.sectionId,
          written: [tok.raw],
          scriptIdx: i,
        });
      }
    }
    for (const b of skippedBuckets) {
      next.events.push({
        kind: "skipped",
        sectionId: b.sectionId,
        written: b.written.join(" "),
        scriptIdx: b.scriptIdx,
      });
      next.skipped += 1;
    }
  }

  const matchedTok = scriptTokens[matchIdx];
  next.currentSectionId = matchedTok.sectionId;

  if (matchKind === "exact") {
    next.events.push({
      kind: "match",
      sectionId: matchedTok.sectionId,
      spoken: spoken.word,
      scriptIdx: matchedTok.scriptIdx,
      tMs: spoken.startMs,
    });
    next.matched += 1;
  } else {
    next.events.push({
      kind: "paraphrase",
      sectionId: matchedTok.sectionId,
      spoken: spoken.word,
      written: matchedTok.raw,
      scriptIdx: matchedTok.scriptIdx,
      tMs: spoken.startMs,
    });
    next.paraphrased += 1;
  }

  next.cursor = matchIdx + 1;

  // If that was the current section's LAST token, the speaker has
  // finished the section — move the live highlight to the next section
  // now, during their breath, instead of waiting for them to say the
  // next section's first words. (Matching a word IN the next section
  // still advances it, above — this just removes the gap lag.)
  const following = scriptTokens[next.cursor];
  if (following && following.sectionId !== matchedTok.sectionId) {
    next.currentSectionId = following.sectionId;
  }

  return next;
}

// Return the most recent N events (used by the bottom bar's transcript window).
export function recentSpoken(state: LiveState, max = 8): string {
  const out: string[] = [];
  for (let i = state.events.length - 1; i >= 0 && out.length < max; i--) {
    const ev = state.events[i];
    if (ev.kind === "match" || ev.kind === "paraphrase" || ev.kind === "improv") {
      out.unshift(ev.spoken);
    }
  }
  return out.join(" ");
}
