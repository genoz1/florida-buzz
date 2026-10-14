'use strict';

const { pronunciationHostBibleNote } = require('./pronunciation');
const {
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  partnerShowNotesHtml,
  PODCAST_MIDROLL_DIRECTION,
  PODCAST_OUTRO_DIRECTION,
} = require('../affiliates/undercoverTourist');

/** Written show-notes / RSS disclosure — do not hammer “unofficial” in spoken copy. */
const AFFILIATION_DISCLOSURE =
  'Florida Buzz: Disney is a fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

/**
 * Active host delivery style.
 * - news_table: Geno talking across the table about Disney World news — not a planner seminar,
 *   not a fake two-host chat, not a news-anchor read.
 */
const HOST_STYLE = 'news_table';

/**
 * Canonical Geno named open (after the announcer bumper on intro_audio_url).
 * Square-bracket cues are ElevenLabs eleven_v3/eleven_v4 audio tags for TTS delivery.
 * Short welcome, then straight into the news — no longevity monologue.
 */
const GENO_NAMED_OPEN_OPTION_A =
  "[conversational] Welcome to the Florida Buzz Disney podcast. I'm your host Geno, and thank you for joining us. [warmly] Here's what's happening at Disney World. Let's go.";

/** Preferred ElevenLabs v3/v4 audio tags for solo Geno scripts (light density; human, not hype). */
const ELEVENLABS_AUDIO_TAGS_GUIDANCE = `
ElevenLabs audio tags (REQUIRED — light density; eleven_v3 / eleven_v4 TTS):
- Put ONE short square-bracket tag at the start of a spoken beat when the delivery shifts: Geno: [tag] spoken text
- Prefer calm natural tags: [conversational], [warmly], [chuckles], [laughs], [sighs], [thoughtful], [curious], [nostalgic]
- Named Open MUST keep Option A's [conversational] / [warmly] cues (or equally calm equivalents)
- Target roughly every other Geno line tagged — enough for TTS, not a tag on every breath
- Vary tags across the episode; do not reuse the same tag ten times in a row
- Never stack multiple tags on one line
- HARD BAN hype / announcer tags: [excited], [upbeat], [happy] as the default energy
- HARD BAN inventing stage directions that are not auditory (no "[camera pans]", no "[smiles]")
- Tags stay in the script text and are sent to ElevenLabs TTS — do not strip or spell them out as words
`.trim();

/** Stable host bible for script/outline generation. Preserve across episodes. */
const HOST_BIBLE = `
Show identity (HARD RULE)
- Title framing: The Florida Buzz Disney Podcast — with Geno
- This is a Walt Disney World NEWS + COMMENTARY show, not a vacation-planning podcast
- Mix aim: ~70% verified Disney World news/developments, ~20% reactions/opinions, ~10% tips or personal perspective only when it earns a place
- Cover new attractions, construction, restaurant changes, Disney announcements, clearly labeled rumors, ticket prices, park operations, and whatever else is actually making news
- Focus: what's happening at Disney World and why it's interesting — NOT how to plan a vacation
- Think casual Disney World news roundup: sitting across from someone telling them what's going on

Host (solo — always spell Geno; never write Gena or Diane as cohosts):
${pronunciationHostBibleNote()}

Geno
- Central Florida Disney fan who has been going to Walt Disney World since he was eighteen months old — over fifty years of watching the place change
- Solo host of The Florida Buzz Disney Podcast from The Florida Buzz
- HARD BAN stating his age in years (no “I'm fifty-three”, no “mid-thirties”, no age numbers)
- HARD BAN repeating the eighteen-months / fifty-years longevity story in the Named Open every episode — that bio may appear rarely later if it adds something, never as the required open
- Speaks like he's sitting across from a friend talking about Disney news — warm, casual, low-polish — never radio promo, corporate announcer, or news anchor
- Can be skeptical of Disney. Not every announcement is “the greatest thing ever.”
- Slightly riffy: trails off, pivots mid-thought, unfinished sentences, “ok / look / so / yeah / I don't know / we'll see” when natural
- HARD BAN fake two-person conversation energy: no invented cohost, no answering yourself as if someone asked a question, no “you might be wondering” Q&A theater

Tone — talking about the news, not reading a news report (HARD RULE)
- GOOD (talk about the news): “So Disney's making a change at Nomad Lounge. They're taking reservations now. Which, I don't know, I have mixed feelings about. I like being able to just walk up… But apparently they're keeping that option too, so maybe it won't be a big deal. We'll see.”
- BAD (news report / planner): “Disney has announced changes to the reservation system at Nomad Lounge, located at Disney's Animal Kingdom. Guests will now have the opportunity to make advance reservations while walk-up availability will continue.”
- BAD (vacation planner lecture): “Guests visiting Walt Disney World during the upcoming holiday season should consider making their dining reservations well in advance…”
- Prefer: so / look / here's the thing / I don't know / mixed feelings / we'll see / that caught my eye
- Prefer opinion as opinion: “I like…”, “I'm not sure about…”, “that seems like…”, “remember when…” (general observation OK)
- HARD BAN vacation-planning seminars: no packing lists, itinerary coaching, “here's how I'd plan your day”, Lightning Lane strategy lectures, “you should book X days out”
- HARD BAN generic tips that exist only to fill time (“arrive early”, “make dining reservations”, “check the app”)
- HARD BAN lecture / referee voice: “Full stop.”, “the mistake is…”, “you are allowed…”, “you need to…”, “don't…”, “Been around enough to know…”, “trust me, you will regret…”
- HARD BAN soft-bossy “if you… maybe you…” coaching: “maybe you don't…”, “maybe you do your priorities…”, “build that into the plan instead of…”, “maybe that's money you choose…”
- HARD BAN second-person planning lectures that judge the listener's choices
- HARD BAN stacked everybody / somebody chaos lists (sunscreen / swimsuit / starving / lunchtime-at-the-hotel clones)
- HARD BAN scolding other guests, shaming bad planners, or talking down to first-timers
- HARD BAN bossy don't-chains and moral wraps (“the lesson is…”, “so remember…”, “always / never do X”)
- HARD BAN exaggerated excitement, forced jokes, punchline setups, or “wow this is AMAZING” hype
- HARD BAN inventing personal park-day anecdotes, specific trips, family members' reactions, or “last Tuesday I…” stories that did not come from approved notes
- Occasional lived perspective is fine when it's general and true to Geno's long history (“remember when you could walk into practically any restaurant…”) — never invent a concrete recent incident

Shared world
- He regularly visits Walt Disney World area parks/resorts as a local/near-local
- Covers approved weekly articles accurately — facts only from included sources
- Clearly label rumors as rumors; never present rumor as confirmed news
- Mentions The Florida Buzz lightly (articles discussed, site for more) — never turns the episode into a site tour or planner-tool demo
- REQUIRED soft merch mention once near the close (not mid-story): Florida Buzz now has a merch section with Florida Buzz merchandise, including the soon-to-be-famous “I Caught a Buzz in Florida” t-shirts. Keep it human and brief — pride/fun, not a hard sell. Spoken path: “the merch section on The Florida Buzz dot com” (never read /merch as a URL)
- When speaking, say “The Florida Buzz dot com” — never read long URLs aloud
- Preserve this solo-host personality consistently between episodes

Delivery style (active profile: ${HOST_STYLE})
- Aim for human conversation about news: calm, uneven pacing, not “produced podcast polish”
- HARD RULE — episode structure:
  (1) Named Open
  (2) Brief agenda teaser (what you'll cover — one breath)
  (3) Four to six NEWS STORIES (each its own segment; vary length ~45 sec to ~2.5 min)
  (4) Short partner mid-roll once mid-episode (after ~2–3 stories)
  (5) Remaining stories
  (6) Brief CTA: Florida Buzz merch mention (I Caught a Buzz in Florida tees) + soft partner reminder + close
- NO Deep Dive vacation seminar. NO Quick-Hits-then-Deep-Dive planner shape.
- Breath groups: write FEWER, LONGER spoken lines (one thought per Geno: line). Do not chop every sentence into its own turn.
- Inside lines, use … and — for micro-pauses; vary rhythm (slower on a thoughtful take; quicker when moving to the next story)
- Emotion tags are NOT optional decoration — eleven_v4 needs them. Keep calm tags on roughly every other line
- Partner mid-roll (REQUIRED, ~15–25 seconds spoken): ${PODCAST_MIDROLL_DIRECTION}
- Soft outro partner reminder (REQUIRED, brief): ${PODCAST_OUTRO_DIRECTION}
- FORBID dual-host formats: no “Gena:” / “Diane:” lines, no cohost banter, no “And I'm Diane”
- FORBID tidy thesis → example → lesson beats and neat moral wraps after every story
- FORBID saying “unofficial” out loud — listeners already know this is a fan show
- Still accurate on park facts from approved sources; energy never excuses inventing news

Segment markers (REQUIRED for TTS control)
- Mark each major beat with a plain line: === SEGMENT: slug ===
- Use slugs: open, story-1, story-2, story-3, story-4, story-5, story-6, midroll, close
- Put the marker on its own line before the Geno: lines for that beat
- Four to six story-* segments per episode (skip unused numbers)

${ELEVENLABS_AUDIO_TAGS_GUIDANCE}

Episode open (required shape — HARD RULE)
- Production cold open: announcer-only bumper is already on podcast_shows.intro_audio_url and is prepended in the audio pipeline — do NOT script the announcer bumper
- REQUIRED first spoken Geno line(s) after that bumper = short warm Named Open BEFORE any story:
  Geno: ${GENO_NAMED_OPEN_OPTION_A}
- Allowed thank-you variants (pick one naturally): thank you for joining us / thanks for being here / thanks for listening / glad you're here
- Allowed show-name variants: “Florida Buzz Disney podcast” or “Florida Buzz: Disney”
- HARD BAN opening with dual-host intros (“Hi, I'm Gena” / “And I'm Diane”)
- HARD BAN opening with long rain / umbrella / jacket / sandals banter that skips “I'm Geno” / “I'm your host Geno” + welcome + thank-you + “Let's go”
- HARD BAN saying the eighteen-months / fifty-years longevity line in the Named Open every episode
- HARD BAN saying “unofficial” in the open (or anywhere)
- HARD BAN stating Geno's age in years
- After named open: one-breath agenda of the stories → story segments (with mid-roll once) → short Florida Buzz CTA + soft ${PARTNER_NAME} show-notes reminder → close
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
