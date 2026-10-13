'use strict';

/**
 * Main Street Magic Ep 912 delivery blueprint for Florida Buzz dual-host tests.
 * Grounded in the first ~10 minutes of:
 * https://podcasts.apple.com/us/podcast/main-street-magic-a-walt-disney-world-podcast/id1271212128?i=1000796085129
 *
 * Goal: sound like a real conversation, not turn-taking script reading.
 */

const MSM_EPISODE_REF = {
  show: 'Main Street Magic',
  episode: '912: Resort Wars Showdown — BoardWalk vs Beach Club',
  appleUrl:
    'https://podcasts.apple.com/us/podcast/main-street-magic-a-walt-disney-world-podcast/id1271212128?i=1000796085129',
};

/** Production targets (guidelines, not metronome). */
const MSM_DELIVERY_TARGETS = Object.freeze({
  wpmNormal: [145, 175],
  wpmExcited: [175, 195],
  wpmThoughtful: [125, 145],
  reactionSec: [0.1, 0.3],
  pauseNormalSec: [0.3, 0.8],
  pauseThoughtfulSec: [0.8, 1.5],
  overlapSec: [0.2, 0.6],
  loudnessLufs: -16,
  truePeakDb: -1.5,
});

/**
 * Script / TTS rules distilled from MSM 912 + anti-polished-clone guidance.
 */
const MSM_DELIVERY_BIBLE = `
DUAL-HOST DELIVERY — Main Street Magic Ep 912 reference (HARD RULES)

Core principle: hosts are HAVING a conversation, not taking turns reading a script.

Host 1 — Geno (experienced Disney visitor, ~50–60, warm, relaxed, occasionally sarcastic)
- Shares personal stays / decades of park days as stories, not lectures
- Gets interrupted mid-thought and keeps going
- Sometimes trails off: "I mean…", "you know what I mean?", unfinished sentences
- HARD BAN radio announcer polish, tidy thesis→example→lesson, upspeak on every line end

Host 2 — Gena (conversational cohost — modern parks, reactive, will disagree)
- Comfortable cutting in: "Yeah, but…", "Okay, what?", "Right."
- Asks spontaneous follow-ups; does not rubber-stamp Geno
- Short reactions (0.1–0.3s energy): laughs, "oh yeah", "that's wild"
- Can win a round / disagree without being mean

Rhythm (vary — never one pace the whole episode)
- Normal talk ~145–175 wpm; excited ~175–195; thoughtful ~125–145
- Normal pauses 0.3–0.8s; thoughtful 0.8–1.5s
- REQUIRED: occasional overlapping dialogue 0.2–0.6s (not just "interrupting" stage directions)

Overlap example (must feel like real interruption, not clean handoff):
Geno: I mean, I love the Beach Club, but when you're paying six or seven hundred a night—
Gena: (overlaps) Yeah, but you're paying for that location.
Geno: Well, sure. But that's kind of my point.
Gena: You can literally walk into EPCOT.
Geno: (laughing) I know you can walk into EPCOT! I've been doing it for thirty years.
Gena: Okay, fair enough.
Geno: But here's what bothers me about the price…

Script formatting for dual audio mixer:
- Lines: "Geno: …" / "Gena: …"
- Mark mid-thought cutoffs with trailing — or …
- Mark overlap intent with leading tag [overlap] on the interrupting line
- Prefer short reactive Gena lines mixed with longer Geno stories
- Open like MSM: short welcome + "I'm your host Geno" + cohost hello — then real-life / park chat, NOT a longevity monologue
- HARD BAN soft-bossy "maybe you don't / maybe you should" coaching — talk about what WE did / I'd do

ElevenLabs tags: light only — [conversational], [chuckles], [laughs], [warmly], [thoughtful]. Never [excited]/[upbeat] as default.
`.trim();

/** Short MSM-style dual sample (~90–120s) for bakeoff / overlap mixer tests. */
const MSM_STYLE_DUAL_SAMPLE_LINES = Object.freeze([
  {
    speaker: 'Geno',
    text: "[conversational] Hello and welcome to the Florida Buzz Disney podcast. I'm your host Geno —",
    gapAfterMs: 80,
  },
  {
    speaker: 'Gena',
    text: '[warmly] Hey guys.',
    overlapPrevMs: 280,
    gapAfterMs: 200,
  },
  {
    speaker: 'Geno',
    text: "[conversational] — and as always I'm here with Gena. Thanks for hanging out with us today.",
    gapAfterMs: 350,
  },
  {
    speaker: 'Geno',
    text: "[conversational] So we're doing a little Boardwalk versus Beach Club gut check… and I'm gonna apologize up front if I sound a little sinus-y. Not really sick, just… you know.",
    gapAfterMs: 180,
  },
  {
    speaker: 'Gena',
    text: "[chuckles] You say that every other recording.",
    overlapPrevMs: 320,
    gapAfterMs: 220,
  },
  {
    speaker: 'Geno',
    text: "[laughs] Fair. We've stayed at Beach Club once, Boardwalk a few times — and I keep coming back to that walk into EPCOT. I mean I love Beach Club, but when you're paying six or seven hundred a night—",
    gapAfterMs: 0,
  },
  {
    speaker: 'Gena',
    text: "[overlap] Yeah, but you're paying for that location.",
    overlapPrevMs: 450,
    gapAfterMs: 120,
  },
  {
    speaker: 'Geno',
    text: "[conversational] Well, sure. But that's kind of my point.",
    gapAfterMs: 100,
  },
  {
    speaker: 'Gena',
    text: 'You can literally walk into EPCOT.',
    overlapPrevMs: 250,
    gapAfterMs: 80,
  },
  {
    speaker: 'Geno',
    text: "[laughs] I know you can walk into EPCOT! I've been doing it for years.",
    overlapPrevMs: 300,
    gapAfterMs: 150,
  },
  {
    speaker: 'Gena',
    text: 'Okay, fair enough.',
    gapAfterMs: 250,
  },
  {
    speaker: 'Geno',
    text: "[thoughtful] But here's what bothers me about the price — if my crew's only there two park days, I start looking at what else that money does for the whole trip.",
    gapAfterMs: 180,
  },
  {
    speaker: 'Gena',
    text: "[curious] So gut check — Boardwalk or Beach Club for you right now?",
    gapAfterMs: 120,
  },
  {
    speaker: 'Geno',
    text: "[conversational] Beach Club. I like walking into that lobby… smells like a beach house living room.",
    gapAfterMs: 100,
  },
  {
    speaker: 'Gena',
    text: "[warmly] Yeah. Boardwalk's fun, but it's busier. I'm with you — Beach Club.",
    overlapPrevMs: 200,
    gapAfterMs: 300,
  },
  {
    speaker: 'Geno',
    text: "[warmly] Alright — more of that next time. Thanks for listening to Florida Buzz.",
    gapAfterMs: 0,
  },
]);

function sampleLinesAsScript(lines = MSM_STYLE_DUAL_SAMPLE_LINES) {
  return lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
}

module.exports = {
  MSM_EPISODE_REF,
  MSM_DELIVERY_TARGETS,
  MSM_DELIVERY_BIBLE,
  MSM_STYLE_DUAL_SAMPLE_LINES,
  sampleLinesAsScript,
};
