// Demo limits that both sides need to agree on.
//
// Separate from demo-limits.ts because that module is `server-only` (it
// reaches for the admin client): the demo page has to know the recording
// cap to run its countdown, and the script cap to warn before submitting.

/** Hard ceiling on the uploaded recording. ~60s of Opus is well under 1 MB. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Deepgram is billed per minute of audio; the demo is a single take. */
export const MAX_AUDIO_SECONDS = 75;
/** Longer scripts cost more to coach and aren't needed to prove the point. */
export const MAX_SCRIPT_CHARS = 6_000;
