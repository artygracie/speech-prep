// Demo limits that both sides need to agree on.
//
// Separate from demo-limits.ts because that module is `server-only` (it
// reaches for the admin client): the demo page needs the recording cap to
// run its countdown.

/** Hard ceiling on the uploaded recording. ~60s of Opus is well under 1 MB. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Deepgram is billed per minute of audio; the demo is a single take. The
 *  sample runs ~70s at an unhurried pace, so this leaves real headroom for
 *  someone reading slowly or restarting a sentence. */
export const MAX_AUDIO_SECONDS = 150;
