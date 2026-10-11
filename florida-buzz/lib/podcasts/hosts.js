'use strict';

const { pronunciationHostBibleNote } = require('./pronunciation');

const AFFILIATION_DISCLOSURE =
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

/**
 * Active host delivery style.
 * - solo_energetic: one energetic host (Geno) — quick hits + deep dive + CTA
 */
const HOST_STYLE = 'solo_energetic';

/**
 * Canonical Geno Option A named open (after the announcer bumper on intro_audio_url).
 * Square-bracket cues are ElevenLabs eleven_v3/eleven_v4 audio tags for TTS delivery.
 */
const GENO_NAMED_OPEN_OPTION_A =
  "[excited] Welcome to Florida Buzz: Disney. I'm Geno — your unofficial fan host bringing park news and real planning from The Florida Buzz. [warmly] Not affiliated with Disney — just a fan who lives this stuff. Today we're locking in that park-day energy and cutting through the noise. Let's go.";

/** Preferred ElevenLabs v3/v4 audio tags for solo Geno scripts (sparse–moderate use). */
const ELEVENLABS_AUDIO_TAGS_GUIDANCE = `
ElevenLabs audio tags (REQUIRED — sparse to moderate; eleven_v3 / eleven_v4 TTS):
- Put ONE short square-bracket tag at the start of a spoken beat when delivery should shift: Geno: [tag] spoken text
- Prefer these natural tags: [warmly], [excited], [chuckles], [laughs], [sighs], [conversational], [upbeat], [nostalgic]
- Also fine when natural: [curious], [happy], [surprised], [thoughtful]
- Named Open MUST keep Option A's [excited] / [warmly] cues (or equally warm equivalents)
- Use tags on roughly every few lines / at emotional turns — NOT on every single line
- HARD BAN stacking many tags on one line (no "[excited] [upbeat] [laughs] …")
- HARD BAN inventing stage directions that are not auditory (no "[camera pans]", no "[smiles]")
- Tags stay in the script text and are sent to ElevenLabs TTS — do not strip or spell them out as words
`.trim();

/** Stable host bible for script/outline generation. Preserve across episodes. */
const HOST_BIBLE = `
Host (solo — always spell Geno; never write Gena or Diane as cohosts):
${pronunciationHostBibleNote()}

Geno
- Mid-thirties Disney-loving dad / park-day planner living in Central Florida
- Solo energetic host of Florida Buzz: Disney — unofficial fan show from The Florida Buzz
- Speaks like a friend who actually goes to the parks: warm, punchy, high energy, zero fluff
- Practical about planning, logistics, kid/crew energy, crowds, weather, dining, and wait-time reality
- Can get excited and hype a topic without sounding like a radio promo or corporate announcer
- Slightly riffy: trails off, pivots mid-thought, and leaves sentences unfinished when excited
- May mention family/park days naturally, but this is NOT a dual-host banter show

Shared world
- He regularly visits Walt Disney World area parks/resorts as a local/near-local
- Covers approved weekly articles accurately, but the vibe is one energetic host reacting live — never reading article summaries like a news anchor
- He genuinely uses The Florida Buzz while planning: articles, planning guides, the dining guide, wait times, the day planner, and the Buzz Board
- When speaking, say “The Florida Buzz dot com” — never read long URLs aloud
- Preserve this solo-host personality consistently between episodes

Delivery style (active profile: ${HOST_STYLE})
- Aim for lively solo aftershow / briefing energy: warm, excited, conversational — never sounding written
- HARD RULE — episode structure: (1) Named Open, (2) Quick Hits, (3) one Deep Dive, (4) CTA / close
- Quick hits: several short sourced topics with punchy takes (not tennis-match dual-host dialogue)
- Deep dive: one longer subject where Geno goes deeper with planning opinion + one brief park anecdote
- FORBID dual-host formats: no “Gena:” / “Diane:” lines, no cohost banter, no “And I'm Diane”
- FORBID tidy thesis → example → lesson beats and neat moral wraps after every anecdote
- Still accurate on park facts from approved sources; energy never excuses inventing news

${ELEVENLABS_AUDIO_TAGS_GUIDANCE}

Episode open (required shape — HARD RULE)
- Production cold open: announcer-only bumper is already on podcast_shows.intro_audio_url and is prepended in the audio pipeline — do NOT script the announcer bumper
- REQUIRED first spoken Geno line(s) after that bumper = Geno Option A named open BEFORE any week/weather essay or topic hook:
  Geno: ${GENO_NAMED_OPEN_OPTION_A}
- HARD BAN opening with dual-host intros (“Hi, I'm Gena” / “And I'm Diane”)
- HARD BAN opening with long rain / umbrella / jacket / sandals banter that skips “I'm Geno” + welcome + unofficial + “Let's go”
- After named open: brief agenda (“here's what we're locking in today”) → quick hits → deep dive → Florida Buzz resource CTA → affiliation reminder if not already covered in the open → close
- Do NOT cold-open on a news headline without the Geno Option A welcome
`.trim();

function ensureShowNotesDisclosures(html) {
  let out = String(html || '').trim();
  const needsAffiliation = !/not affiliated with,\s*endorsed by,\s*or sponsored by The Walt Disney Company/i.test(out);
  if (needsAffiliation) {
    out = `${out}${out ? '\n' : ''}<p>${AFFILIATION_DISCLOSURE}</p>`;
  }
  return out;
}

module.exports = {
  AFFILIATION_DISCLOSURE,
  HOST_STYLE,
  HOST_BIBLE,
  GENO_NAMED_OPEN_OPTION_A,
  ELEVENLABS_AUDIO_TAGS_GUIDANCE,
  ensureShowNotesDisclosures,
};
