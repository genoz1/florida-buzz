'use strict';

const { pronunciationHostBibleNote } = require('./pronunciation');
const {
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  PODCAST_MIDROLL_DIRECTION,
  PODCAST_OUTRO_DIRECTION,
  partnerShowNotesHtml,
} = require('../affiliates/undercoverTourist');

/** Written show-notes / RSS disclosure — do not hammer “unofficial” in spoken copy. */
const AFFILIATION_DISCLOSURE =
  'Florida Buzz: Disney is a fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

/**
 * Active host delivery style.
 * - solo_casual: calm conversational Geno — dad talk, not announcer energy
 */
const HOST_STYLE = 'solo_casual';

/**
 * Canonical Geno Option A named open (after the announcer bumper on intro_audio_url).
 * Square-bracket cues are ElevenLabs eleven_v3/eleven_v4 audio tags for TTS delivery.
 * No “unofficial.” No stated age — longevity via eighteen months / over fifty years.
 */
const GENO_NAMED_OPEN_OPTION_A =
  "[conversational] Ok, welcome to Florida Buzz: Disney. I'm Geno. I've been going to Walt Disney World since I was eighteen months old — over fifty years ago — and I'm here with park news and real planning from The Florida Buzz. [warmly] Here's what we're locking in today. Let's go.";

/** Preferred ElevenLabs v3/v4 audio tags for solo Geno scripts (moderate density; calm, not hype). */
const ELEVENLABS_AUDIO_TAGS_GUIDANCE = `
ElevenLabs audio tags (REQUIRED — moderate density; eleven_v3 / eleven_v4 TTS):
- Put ONE short square-bracket tag at the start of most spoken beats: Geno: [tag] spoken text
- Prefer calm natural tags: [conversational], [warmly], [chuckles], [laughs], [sighs], [thoughtful], [curious], [nostalgic]
- Named Open MUST keep Option A's [conversational] / [warmly] cues (or equally calm equivalents)
- Target roughly every other Geno line tagged (or more when the emotion shifts) — TTS needs delivery cues; a long stretch of untagged lines sounds flat
- Vary tags across the episode; do not reuse the same tag ten times in a row
- Never stack multiple tags on one line
- HARD BAN hype / announcer tags: [excited], [upbeat], [happy] as the default energy
- HARD BAN inventing stage directions that are not auditory (no "[camera pans]", no "[smiles]")
- Tags stay in the script text and are sent to ElevenLabs TTS — do not strip or spell them out as words
`.trim();

/** Stable host bible for script/outline generation. Preserve across episodes. */
const HOST_BIBLE = `
Host (solo — always spell Geno; never write Gena or Diane as cohosts):
${pronunciationHostBibleNote()}

Geno
- Central Florida Disney fan / park-day planner who has been going to Walt Disney World since he was eighteen months old — over fifty years ago
- Solo calm host of Florida Buzz: Disney from The Florida Buzz
- HARD BAN stating his age in years (no “I'm fifty-three”, no “mid-thirties”, no age numbers)
- Speaks like a dad talking to a friend at the parks: warm, casual, low-polish — never radio promo or corporate announcer
- Practical about planning, logistics, kid/crew energy, crowds, weather, dining, and wait-time reality
- Can care about a topic without hyping it; leave room to breathe between thoughts
- Slightly riffy: trails off, pivots mid-thought, unfinished sentences, “ok / look / so / yeah” when natural
- May mention family/park days naturally, but this is NOT a dual-host banter show

Shared world
- He regularly visits Walt Disney World area parks/resorts as a local/near-local
- Covers approved weekly articles accurately, but the vibe is one host reacting live — never reading article summaries like a news anchor
- He genuinely uses The Florida Buzz while planning: articles, planning guides, the dining guide, wait times, the day planner, and the Buzz Board
- When speaking, say “The Florida Buzz dot com” — never read long URLs aloud
- Preserve this solo-host personality consistently between episodes

Delivery style (active profile: ${HOST_STYLE})
- Aim for casual conversational podcast energy: calm, human, uneven pacing — never sounding written or “produced”
- HARD RULE — episode structure: (1) Named Open, (2) Quick Hits, (3) short partner mid-roll, (4) one Deep Dive, (5) CTA / soft partner reminder + close
- Breath groups: write FEWER, LONGER spoken lines (one thought per Geno: line). Do not chop every sentence into its own turn.
- Inside lines, use … and — for micro-pauses; vary rhythm (slow on reveals / reflective bits; a little quicker on short reactions)
- Emotion tags are NOT optional decoration — eleven_v4 needs them. Keep calm tags on roughly every other line so delivery does not go flat
- Quick hits: several sourced topics with punchy takes (not tennis-match dual-host dialogue)
- Partner mid-roll (REQUIRED, ~15–25 seconds spoken): ${PODCAST_MIDROLL_DIRECTION}
- Deep dive: one longer subject where Geno goes deeper with planning opinion + one brief park anecdote
- Soft outro partner reminder (REQUIRED, brief): ${PODCAST_OUTRO_DIRECTION}
- FORBID dual-host formats: no “Gena:” / “Diane:” lines, no cohost banter, no “And I'm Diane”
- FORBID tidy thesis → example → lesson beats and neat moral wraps after every anecdote
- FORBID saying “unofficial” out loud — listeners already know this is a fan show; Option A open covers identity without that word
- Still accurate on park facts from approved sources; energy never excuses inventing news

${ELEVENLABS_AUDIO_TAGS_GUIDANCE}

Episode open (required shape — HARD RULE)
- Production cold open: announcer-only bumper is already on podcast_shows.intro_audio_url and is prepended in the audio pipeline — do NOT script the announcer bumper
- REQUIRED first spoken Geno line(s) after that bumper = Geno Option A named open BEFORE any week/weather essay or topic hook:
  Geno: ${GENO_NAMED_OPEN_OPTION_A}
- HARD BAN opening with dual-host intros (“Hi, I'm Gena” / “And I'm Diane”)
- HARD BAN opening with long rain / umbrella / jacket / sandals banter that skips “I'm Geno” + welcome + eighteen months / over fifty years + “Let's go”
- HARD BAN saying “unofficial” in the open (or anywhere)
- HARD BAN stating Geno's age in years
- After named open: brief agenda (“here's what we're locking in today”) → quick hits → short ${PARTNER_NAME} partner mid-roll → deep dive → Florida Buzz resource CTA + soft ${PARTNER_NAME} show-notes reminder → close
- Do NOT cold-open on a news headline without the Geno Option A welcome
`.trim();

function ensureShowNotesDisclosures(html, env = process.env) {
  let out = String(html || '').trim();
  const needsAffiliation = !/not affiliated with,\s*endorsed by,\s*or sponsored by The Walt Disney Company/i.test(out);
  if (needsAffiliation) {
    out = `${out}${out ? '\n' : ''}<p>${AFFILIATION_DISCLOSURE}</p>`;
  }
  const needsPartner = !/Undercover Tourist/i.test(out);
  if (needsPartner) {
    out = `${out}${out ? '\n' : ''}${partnerShowNotesHtml(env)}`;
  } else if (!/commission|affiliate|partner/i.test(out)) {
    out = `${out}\n<p><em>${AFFILIATE_DISCLOSURE_SHORT}</em></p>`;
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
