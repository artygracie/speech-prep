// The wedding roles SpeechPrep is marketed around.
//
// One entry per landing page. These exist because search demand is by
// role, not by category: "best man speech" is 5,400/mo and "speech
// practice app" is 30. Someone searching their role does not yet know
// tools like this exist, so each page has to be useful on its own —
// answer the question they actually typed — before it asks for anything.
//
// Copy register per Arty UI: the coach — encouraging, private. Never
// jokey about the speech itself; the reader is quietly nervous.

export type RoleFaq = { q: string; a: string };

export type Role = {
  slug: string;
  /** The occasion value stored on speeches — matches OCCASIONS. */
  occasion: string;
  /** Page <h1>. Mirrors the search phrase without reading like SEO bait. */
  h1: string;
  /** <title> */
  title: string;
  metaDescription: string;
  eyebrow: string;
  /** Two or three sentences under the h1. The promise, in plain words. */
  intro: string;
  /** How long this speech should actually run, and why. */
  length: string;
  /** The shape of the speech, as beats. Not a template to fill in. */
  beats: { name: string; detail: string }[];
  /** The specific thing that goes wrong for this role. */
  pitfall: { title: string; detail: string };
  faqs: RoleFaq[];
};

export const ROLES: Role[] = [
  {
    slug: "best-man-speech",
    occasion: "Best man",
    h1: "The best man speech",
    title: "Best Man Speech: How to Write One and Actually Deliver It",
    metaDescription:
      "How long a best man speech should be, the shape that works, and the part nobody practises: saying it out loud. Read one aloud free, no account needed.",
    eyebrow: "For the best man",
    intro:
      "You have known him for years and you have about four minutes to prove it. The writing is the part everyone worries about. The delivery is the part that actually goes wrong.",
    length:
      "Three to five minutes. That is roughly 400 to 700 words. Almost every best man speech that dies does so because it ran nine minutes, not because the jokes were weak.",
    beats: [
      {
        name: "Who you are",
        detail:
          "One line. Half the room has never met you, and they will not follow a story from a stranger they cannot place.",
      },
      {
        name: "One story",
        detail:
          "Not four. One specific story with a real detail in it beats a list of adjectives about what a great guy he is.",
      },
      {
        name: "The turn",
        detail:
          "The moment he met her, and what visibly changed. This is the part the couple remembers, and the part most speeches rush.",
      },
      {
        name: "The toast",
        detail:
          "Address her, address him, raise the glass. Land it cleanly and sit down while they are still smiling.",
      },
    ],
    pitfall: {
      title: "The in-joke that only eight people get",
      detail:
        "The reliable test is reading it out loud to someone who was not there. If you have to explain the setup, it will land in silence with 120 people watching. Cut it, or spend one sentence making it land for everyone.",
    },
    faqs: [
      {
        q: "How long should a best man speech be?",
        a: "Three to five minutes. Read yours out loud and time it before you decide it is short enough. Almost everyone reads faster in their head than they speak at a microphone, and nerves make it slower still.",
      },
      {
        q: "Should I memorise it or read from cards?",
        a: "Cards are completely fine and nobody will judge you for them. What people notice is whether you look up. Knowing it well enough to glance down rather than read down is the goal, not word-perfect recall.",
      },
      {
        q: "How do I stop my voice shaking?",
        a: "It is adrenaline, and it settles about thirty seconds in. The reliable fix is having said the first two sentences out loud enough times that you do not need to think about them while your hands are shaking.",
      },
      {
        q: "Can the speech be too clean?",
        a: "Yes. A speech with no specific detail in it sounds like it could be about anyone. One real, slightly unflattering, obviously affectionate detail is worth more than a paragraph of praise.",
      },
    ],
  },
  {
    slug: "maid-of-honor-speech",
    occasion: "Maid of honor",
    h1: "The maid of honor speech",
    title: "Maid of Honor Speech: How to Write One and Actually Deliver It",
    metaDescription:
      "How long a maid of honor speech should be, the shape that works, and how to get through it without crying. Read one aloud free, no account needed.",
    eyebrow: "For the maid of honor",
    intro:
      "You know her better than almost anyone in the room, which is exactly what makes this hard. There is too much to say and a very short window to say it in.",
    length:
      "Three to five minutes. The most common mistake is not length but pace: reading the whole thing at the speed of nerves, so a well-written four minutes arrives as a breathless two.",
    beats: [
      {
        name: "Who you are to her",
        detail:
          "One line, and resist the urge to prove the friendship with a timeline. The stories will do that.",
      },
      {
        name: "Who she is",
        detail:
          "One story that shows it rather than lists it. The detail people remember is usually small and specific, not the big obvious one.",
      },
      {
        name: "Who they are together",
        detail:
          "What you noticed change in her. You have a vantage point on this that nobody else at the microphone has.",
      },
      {
        name: "The toast",
        detail: "To both of them, by name. Short, and then stop.",
      },
    ],
    pitfall: {
      title: "Crying in the middle, not at the end",
      detail:
        "It is not the emotion that breaks a speech, it is arriving at it unprepared. If a line gets you every time you rehearse it, that is useful information: either move it later, or say it enough times out loud that you can get through it.",
    },
    faqs: [
      {
        q: "How long should a maid of honor speech be?",
        a: "Three to five minutes. Time it out loud rather than estimating, because nerves change your pace more than you expect, usually by speeding you up.",
      },
      {
        q: "How do I not cry?",
        a: "Find the line that sets you off, and rehearse that line specifically until it is familiar rather than raw. Most people can get through anything on the fifth pass that undid them on the first. A pause and a breath is always better than pushing through a wobble.",
      },
      {
        q: "Should I mention her ex or her past?",
        a: "No. Even affectionately, even as a joke that lands in the room, it is the line people repeat afterwards for the wrong reasons.",
      },
      {
        q: "Do I have to be funny?",
        a: "No. Warm and specific beats funny and generic every time. If a joke arrives naturally, keep it; if you are writing jokes to fill a quota, cut them.",
      },
    ],
  },
  {
    slug: "father-of-the-bride-speech",
    occasion: "Father of the bride",
    h1: "The father of the bride speech",
    title: "Father of the Bride Speech: How to Write One and Deliver It",
    metaDescription:
      "How long a father of the bride speech should be, what to include, and how to get through the emotional part. Read one aloud free, no account needed.",
    eyebrow: "For the father of the bride",
    intro:
      "You are usually first, which means you set the tone for every speech that follows. It is also the one people most often describe afterwards as the moment the room went quiet.",
    length:
      "Four to six minutes. You have slightly more room than the wedding party, partly because you are also welcoming people, but the same rule holds: time it out loud.",
    beats: [
      {
        name: "Welcome",
        detail:
          "Thank the people who travelled and the people who helped. Briefly. This is the part that quietly expands if you let it.",
      },
      {
        name: "Her",
        detail:
          "One story from when she was young, and one observation about who she is now. The contrast is the whole speech.",
      },
      {
        name: "Them",
        detail:
          "Welcome your new son or daughter in law properly and by name, and say something specific about them. Everyone notices if this part is generic.",
      },
      {
        name: "The toast",
        detail: "To the couple. Then stop, even though you could keep going.",
      },
    ],
    pitfall: {
      title: "The list of thank yous that becomes the speech",
      detail:
        "Thank yous feel obligatory, so they expand until they are half the speech. Keep them to thirty seconds at the top, and let the story be the thing people actually hear.",
    },
    faqs: [
      {
        q: "How long should a father of the bride speech be?",
        a: "Four to six minutes. Since you often go first, running long pushes every other speaker into a room that has started eating.",
      },
      {
        q: "What if I get emotional?",
        a: "Most people do, and nobody minds at all. Pause, breathe, and carry on. What actually helps is rehearsing the emotional line out loud several times so it is worn in rather than raw.",
      },
      {
        q: "Do I welcome the other family?",
        a: "Yes, and by name. It is the most noticed omission in this particular speech.",
      },
      {
        q: "Should I write it out in full or use notes?",
        a: "Write it in full, then rehearse it until you can deliver it from a few prompts. Full text on the night is fine too, as long as you have said it aloud enough to look up.",
      },
    ],
  },
  {
    slug: "mother-of-the-groom-speech",
    occasion: "Mother of the groom",
    h1: "The mother of the groom speech",
    title: "Mother of the Groom Speech: How to Write One and Deliver It",
    metaDescription:
      "What to say in a mother of the groom speech, how long it should run, and how to rehearse it. Read one aloud free, no account needed.",
    eyebrow: "For the mother of the groom",
    intro:
      "This speech is becoming much more common, and there is less received wisdom about it, which is freeing once you stop looking for a template that does not exist.",
    length:
      "Three to five minutes. Shorter than the father of the bride, and it does not need to do any of the hosting or housekeeping work.",
    beats: [
      {
        name: "Him",
        detail:
          "One story from before he was the adult in the room. Specific, and ideally slightly embarrassing in a fond way.",
      },
      {
        name: "Her, or them",
        detail:
          "Welcome your new daughter or son in law by name, and say what you saw change in him. This is the heart of it.",
      },
      {
        name: "Something you mean",
        detail:
          "One honest line about marriage, or about them. Skip it entirely rather than reaching for a quotation.",
      },
      { name: "The toast", detail: "To the couple, by name." },
    ],
    pitfall: {
      title: "Talking about your son to the exclusion of his partner",
      detail:
        "It is the most natural thing in the world and the most commented on afterwards. A good check is counting the sentences: if your son has ten and their partner has two, rebalance before the day.",
    },
    faqs: [
      {
        q: "Is a mother of the groom speech traditional?",
        a: "Not historically, but it is increasingly common and nobody will find it out of place. Treat the absence of tradition as permission to write something that sounds like you.",
      },
      {
        q: "How long should it be?",
        a: "Three to five minutes. Time it out loud rather than by word count.",
      },
      {
        q: "What should I avoid?",
        a: "Comparisons to previous partners, anything about grandchildren, and any joke that has an edge to it about the couple's plans. Warmth is the whole job here.",
      },
      {
        q: "Should I speak with my husband or partner?",
        a: "You can, and it works well if you genuinely rehearse the handovers. Two people who have not practised passing the microphone is the most common way a joint speech loses the room.",
      },
    ],
  },
];

export function roleBySlug(slug: string): Role | undefined {
  return ROLES.find((r) => r.slug === slug);
}
