// Speech writer. Full-bleed focused screen — no shell nav.
// Auth is handled by the parent /app layout.

import { SpeechWriter } from "./writer";

export const metadata = { title: "Write your speech — SpeechPrep" };

export default function WritePage() {
  return <SpeechWriter />;
}
