// The one speech the demo uses.
//
// The demo is not a writing tool — it exists to let someone hear themselves
// read something out loud and get real feedback on the delivery. So the
// script is fixed, and it lives on the server: the demo endpoint never
// accepts a script from the client, which keeps user-supplied prose out of
// an unauthenticated model call entirely.
//
// A best-man toast on purpose: the highest-volume wedding role in search,
// and it gives the coach something to actually say — a story beat to pace,
// a joke to land, and a raise-your-glasses line not to rush.
//
// Sections are hand-cut rather than run through autoSection so the report's
// section names read like a speech ("The story", "The turn") instead of
// generic parts, and so the timing targets are deliberate.

export const SAMPLE_TITLE = "Best man speech for Tom";
export const SAMPLE_OCCASION = "Best man";

export type SampleSection = {
  name: string;
  body: string;
  target_seconds: number;
};

export const SAMPLE_SECTIONS: SampleSection[] = [
  {
    name: "The open",
    target_seconds: 20,
    body: "For those who don't know me, I'm Danny. Tom and I met the first week of university, when he knocked on my door at two in the morning to ask if I owned a screwdriver. I did not. We spent the next hour trying to take a bed frame apart with a butter knife.",
  },
  {
    name: "The story",
    target_seconds: 15,
    body: "That's Tom. He will start something with absolutely no plan, and somehow you will end up helping him finish it, and somehow you will enjoy it.",
  },
  {
    name: "The turn",
    target_seconds: 20,
    body: "Then he met Sarah. And for the first time in fifteen years, Tom had a plan. He had a ring, he had a speech, he had the restaurant booked. He was so nervous he left the ring in the car.",
  },
  {
    name: "The toast",
    target_seconds: 15,
    body: "Sarah, thank you for taking him on. Tom, thank you for being the kind of friend who knocks at two in the morning. Please raise your glasses to Tom and Sarah.",
  },
];

/** The full script as the reader sees it, paragraphs in order. */
export const SAMPLE_SPEECH = SAMPLE_SECTIONS.map((s) => s.body).join("\n\n");

export const SAMPLE_TARGET_SECONDS = SAMPLE_SECTIONS.reduce(
  (total, s) => total + s.target_seconds,
  0,
);
