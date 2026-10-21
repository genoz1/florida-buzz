'use strict';

const {
  AFFILIATION_DISCLOSURE,
  HOST_BIBLE,
  GENO_NAMED_OPEN_OPTION_A,
  ELEVENLABS_AUDIO_TAGS_GUIDANCE,
} = require('./hosts');
const { verifiedToolsBlock } = require('./siteResources');
const {
  PARTNER_NAME,
  PODCAST_MIDROLL_DIRECTION,
  PODCAST_OUTRO_DIRECTION,
} = require('../affiliates/undercoverTourist');

// Back-compat export name used by older imports/tests.
const DISCLOSURE = AFFILIATION_DISCLOSURE;

/** Match ElevenLabs square-bracket audio tags like [excited] / [warmly]. */
const ELEVENLABS_AUDIO_TAG_RE = /\[[a-z][a-z0-9 ,'-]{0,40}\]/gi;
const SEGMENT_MARKER_RE = /^===\s*SEGMENT:\s*([a-z0-9-]+)\s*===/i;

// Target ~12–15 minutes (~150 wpm → ~1,800–2,400 spoken words). Prefer finishing strong over padding.
const CONVERSATION_MAX_OUTPUT_TOKENS = Number(process.env.PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS || 12000);
const CONVERSATION_MIN_WORDS = Number(process.env.PODCASTS_SCRIPT_MIN_WORDS || 1800);
const CONVERSATION_TARGET_MAX_WORDS = Number(process.env.PODCASTS_SCRIPT_TARGET_MAX_WORDS || 2400);
const CONVERSATION_REQUEST_TIMEOUT_MS = Number(process.env.PODCASTS_SCRIPT_TIMEOUT_MS || 420000);
const CONVERSATION_CONTINUE_ATTEMPTS = Number(process.env.PODCASTS_SCRIPT_CONTINUE_ATTEMPTS || 2);

function countScriptWords(scriptText) {
  return String(scriptText || '')
    .replace(/^===\s*SEGMENT:.*?===\s*$/gim, ' ')
    .replace(/^Geno:\s*/gim, ' ')
    .replace(/^Gena:\s*/gim, ' ')
    .replace(/^Diane:\s*/gim, ' ')
    .replace(ELEVENLABS_AUDIO_TAG_RE, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Hard-require short Geno named open before topic hooks / weather essays.
 * Longevity monologue is banned from the required open (bio may appear rarely later).
 */
function assertScriptOpenShape(scriptText) {
  const lines = String(scriptText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Generated script is empty');

  const dialogue = lines.filter((l) => /^Geno:/i.test(l));
  if (!dialogue.length) throw new Error('Script open must use Geno: dialogue lines');

  const headText = dialogue.slice(0, 4).join('\n');
  const earlyText = dialogue.slice(0, 8).join('\n');
  const first = dialogue[0] || '';

  if (/^(Gena|Diane):/im.test(String(scriptText || '').split(/\n+/).slice(0, 8).join('\n'))) {
    throw new Error('Script open bans dual-host Gena/Diane lines — solo Geno only');
  }
  if (/^Geno:\s*Okay,?\s*how was your week/i.test(first)) {
    throw new Error('Script open bans the weather-only cold open ("Okay, how was your week…")');
  }
  if (!/I['’]?m(?:\s+your\s+host)?\s+Geno/i.test(headText)) {
    throw new Error('Script open must include I\'m Geno / I\'m your host Geno in the first spoken lines');
  }
  if (!/welcome to (?:the\s+)?Florida Buzz(?:\s+Disney(?:\s+podcast)?|:?\s*Disney)/i.test(headText)) {
    throw new Error('Script open must welcome listeners to the Florida Buzz Disney podcast');
  }
  const hasThanks =
    /glad you(?:'re| are) here/i.test(headText) ||
    (/(thank you for|thanks for)/i.test(headText) &&
      /(joining us|being here|listening)/i.test(headText));
  if (!hasThanks) {
    throw new Error(
      'Script open must thank listeners (joining us / being here / listening) or say glad you\'re here'
    );
  }
  if (/(eighteen|18)\s+months?/i.test(earlyText) && /(fifty|50)\s+years?/i.test(earlyText)) {
    throw new Error(
      'Script open must not repeat the eighteen months / fifty years longevity monologue every episode'
    );
  }
  if (/unofficial/i.test(earlyText)) {
    throw new Error('Script open must not say “unofficial” — listeners already know');
  }
  if (/\bI['’]?m\s+\d{2,}\b|\bmid[- ]thirties\b|\bfifty[- ]three\b|\b53\b/i.test(earlyText)) {
    throw new Error('Script open must not state Geno\'s age in years');
  }
  if (!/let['’]?s go/i.test(earlyText)) {
    throw new Error('Script open must end the named open with Let\'s go (Geno Option A)');
  }
}

function appendContinuation(existing, continuation) {
  const base = String(existing || '').trim();
  let next = String(continuation || '').trim();
  if (!next) return base;
  const looksLikeRestart =
    (/^Geno:\s*(Welcome to Florida Buzz|Hey|Hi)/i.test(next) && /I['’]?m Geno/i.test(next.slice(0, 500))) ||
    (/welcome back to Florida Buzz/i.test(next.slice(0, 400)));
  if (looksLikeRestart) {
    const lines = next.split(/\n+/).filter((line) => line.trim());
    const baseHead = base.slice(0, 400);
    while (lines.length && baseHead.includes(lines[0].trim().slice(0, 40))) {
      lines.shift();
    }
    next = lines.join('\n\n').trim();
  }
  if (!next) return base;
  return `${base}\n\n${next}`;
}

function sourceBlockFor(sources) {
  return (sources || [])
    .filter((s) => s.included)
    .map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}\n   Notes: ${s.summary || '(none)'}`)
    .join('\n');
}

function buildOutlinePrompt({ show, episode, sources }) {
  const sourceBlock = sourceBlockFor(sources);
  return {
    system: `You outline full episodes for "${show.title}" from The Florida Buzz.

${HOST_BIBLE}

Outline rules:
- Always spell Geno. Solo host only — never outline Gena/Diane dual-host segments.
- Shape a Disney World NEWS + COMMENTARY roundup — someone talking about the news across the table, not a vacation planner seminar, not a dual-host chat, not a news-anchor read.
- Segment 1 MUST be Named Open and MUST list short warm Geno Option A beats explicitly before any story:
  1) Welcome to the Florida Buzz Disney podcast (or Florida Buzz: Disney)
  2) I'm your host Geno / I'm Geno
  3) Thank you for joining us / being here / listening (vary)
  4) Here's what's happening at Disney World / Let's go
- HARD BAN putting the eighteen-months / fifty-years longevity monologue in Segment 1
- Plan 4–6 story segments from included sources (mark each as Story 1…Story 6). Vary length — some ~45–75 seconds, a couple up to ~2–2.5 minutes. No single 5-minute planning deep dive.
- After Named Open: one-breath agenda → stories → insert Partner mid-roll after story 2 or 3 → remaining stories → close.
- Mark TTS segment slugs explicitly (open / story-1… / midroll / close).
- Plan light ElevenLabs audio tags (Named Open keeps [conversational]/[warmly]; stories tag roughly every other Geno line with calm tags). Prefer calm tags — avoid [excited]/[upbeat].
- HARD BAN Segment 1 dual-host intros or weather-only cold opens that skip I'm Geno + welcome + thank-you + Let's go.
- HARD BAN outlining spoken “unofficial” or stating Geno's age in years.
- HARD BAN vacation-planning lectures, packing lists, itinerary coaching, Lightning Lane strategy seminars, generic “arrive early / book dining” tips.
- HARD BAN lecture / referee beats: no “Full stop.”, “the mistake is…”, “you are allowed…”, “you need to…”, bossy don't-chains, “Been around enough…”, or scolding other guests.
- HARD BAN soft-bossy “if you… maybe you…” coaching outlines. Opinions are fine; planning checklists are not.
- HARD BAN inventing personal park-day anecdotes or concrete recent trips. General long-time perspective is OK sparingly.
- Cover each included source topic accurately using only facts from the source notes.
- Separate verified source facts from host opinions. Label rumors as rumors.
- Plan 1–2 light Florida Buzz mentions total (not a tool tour) plus a brief CTA near the close.
- REQUIRED close YouTube CTA (mark as "YouTube:"): one short natural line asking viewers to like and subscribe if they're watching on YouTube. No hard sell.
- REQUIRED close merch beat (mark as "Merch:"): mention the merch section on The Florida Buzz with Florida Buzz merchandise, including the soon-to-be-famous “I Caught a Buzz in Florida” t-shirts. One breath, human, not a hard sell.
- REQUIRED Partner mid-roll segment (mark as "Partner mid-roll:"): ${PODCAST_MIDROLL_DIRECTION}
- REQUIRED Soft outro partner reminder in the close (mark as "Partner outro:"): ${PODCAST_OUTRO_DIRECTION}
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, or URLs.
- When source notes lack a dated park detail, skip that detail — do not invent news.
- Do not place a promotion inside an emotional or personal observation beat.
- No Disney affiliation or inside-access claims.
- This is ONE standalone episode. Never outline “Part 1”, “Part 2”, or a tease for another half of the same show.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} — this is a complete episode, not a multi-part show.
Included sources (approved weekly material — factual base only; prefer 4–6 Disney World news stories):
${sourceBlock || '(none yet — do not invent dated news; outline a short evergreen commentary only if needed)'}

Verified Florida Buzz tools hosts may mention lightly near the close (do not turn the episode into a planner demo):
${verifiedToolsBlock()}

Write a segment outline for an approximately 12–15 minute solo Geno episode (~1,800–2,400 spoken words when scripted). Segment 1 Named Open MUST be short Geno Option A (welcome to the Florida Buzz Disney podcast / I'm your host Geno / thank you for joining us / what's happening at Disney World / let's go — never “unofficial”, never the eighteen-months longevity monologue). Then 4–6 news stories with varied pacing, a short ${PARTNER_NAME} partner mid-roll once mid-episode, light Florida Buzz CTA, a soft ${PARTNER_NAME} show-notes reminder, and a full standalone close — never “see you in Part 2.”`,
  };
}

function buildConversationPrompt({ show, episode, outline, sources }) {
  const sourceBlock = (sources || [])
    .filter((s) => s.included)
    .map((s, i) => `${i + 1}. ${s.title} — ${s.url}${s.summary ? `\n   Notes: ${s.summary}` : ''}`)
    .join('\n');
  return {
    system: `You write natural full-episode podcast scripts for "${show.title}".
Format every spoken line as:
Geno: ...
or with an ElevenLabs audio tag at the start of the spoken beat:
Geno: [conversational] Welcome to the Florida Buzz Disney podcast. I'm your host Geno...
Geno: [thoughtful] So Disney's making a change at Nomad Lounge...

Also mark each major beat on its own line before the spoken lines:
=== SEGMENT: open ===
=== SEGMENT: story-1 ===
=== SEGMENT: midroll ===
=== SEGMENT: close ===

${HOST_BIBLE}

${ELEVENLABS_AUDIO_TAGS_GUIDANCE}

Conversation requirements:
- Target roughly 12–15 minutes of natural solo talk (~1,800–2,400 spoken words). Faster-moving news roundup — do not pad to hit a longer runtime.
- Write a FULL episode script in one pass when possible — do not stop after a short open or a few topics.
- Sound like Geno sitting across from someone talking about Disney World news — NOT a news anchor reading a report, NOT a vacation planner, NOT a fake two-host conversation.
- GOLD STANDARD STORY VOICE (match this energy):
  “So Disney's making a change at Nomad Lounge. They're taking reservations now. Which, I don't know, I have mixed feelings about. I like being able to just walk up to a place without having to plan everything ahead of time. But apparently they're keeping that option too, so maybe it won't be a big deal. We'll see.”
- BAD voice to avoid: “Disney has announced changes to the reservation system… Guests will now have the opportunity…”
- Casual wording: “ok / look / so / yeah / here's the thing / I don't know / we'll see…” when natural.
- Breath groups: FEWER, LONGER Geno: lines (one breath / one thought). Do not split every sentence onto its own line. Use … and — inside lines for micro-pauses.
- Light calm audio tags so eleven_v4 has delivery cues: tag roughly every other Geno: line. Prefer [conversational], [warmly], [chuckles], [nostalgic], [thoughtful], [sighs], [curious]. Avoid [excited] / [upbeat].
- SOLO STRUCTURE (critical):
  1) === SEGMENT: open === Named Open — Geno Option A (exact intent; wording may vary the thank-you beat; keep audio tags):
     Geno: ${GENO_NAMED_OPEN_OPTION_A}
     Allowed thank-you variants: thank you for joining us / thanks for being here / thanks for listening / glad you're here
     Then one breath teaser of the stories coming up.
  2) === SEGMENT: story-1 === … story-4/5/6 === — four to six verified news stories. Vary length. Change topics before listeners get bored.
  3) === SEGMENT: midroll === once after story 2 or 3 — SHORT (~15–25 seconds): ${PODCAST_MIDROLL_DIRECTION}
  4) === SEGMENT: close === — REQUIRED merch beat + soft ${PARTNER_NAME} show-notes reminder + warm goodbye
     Merch beat (REQUIRED, ~10–20 seconds, before or after the partner soft outro): mention that Florida Buzz has a new merch section with awesome Florida Buzz merchandise — including the soon-to-be-famous “I Caught a Buzz in Florida” t-shirts — on The Florida Buzz dot com. Keep it casual and proud, not a hard sell. Do not read /merch aloud as a URL path.
- HARD BAN dual-host dialogue (no Gena:/Diane: lines, no cohost reactions, no answering yourself as a second person).
- HARD BAN opening with "Okay, how was your week" weather essays that skip I'm Geno + welcome + thank-you + Let's go.
- HARD BAN the eighteen-months / fifty-years longevity monologue in the Named Open.
- HARD BAN saying “unofficial” anywhere in the spoken script.
- HARD BAN stating Geno's age in years.
- HARD BAN vacation-planning seminars, packing lists, itinerary coaching, Lightning Lane strategy lectures, generic “arrive early / book dining” filler tips.
- HARD BAN inventing personal park-day anecdotes, concrete recent trips, or family reactions not in the notes.
- HARD BAN writing a full episode with no square-bracket audio tags after the open.
- HARD BAN lecture / referee phrasing: “Full stop.”, “the mistake is…”, “you are allowed…”, “you need to…”, “Been around enough…”, bossy don't-chains, “the lesson is…”, “so remember…”, scolding other guests or first-timers.
- HARD BAN soft-bossy second-person coaching even when hedged: “maybe you don't…”, “maybe you do your priorities…”, “build that into the plan instead of…”, “maybe that's money you choose…”
- HARD BAN stacked everybody / somebody chaos lists — especially hotel-morning stacks.
- HARD BAN exaggerated excitement, forced humor, or hype-host energy.
- Cover approved source topics accurately; weave facts into human talk and opinion. Label rumors clearly.
- Clearly distinguish factual information from personal opinion when discussing prices, policies, hours, attraction status, or wait times — those facts must come only from approved/current sources.
- Uneven pacing is good: some stories short, a couple longer; allow mid-thought pivots and unfinished sentences.
- Show identity is in the short Option A welcome — do not add an “unofficial” disclaimer speech.
- Do not claim a live studio audience, callers, or TV panel format.

Florida Buzz listener guidance (light touch):
- Mention The Florida Buzz sparingly — usually the article you're talking about and a brief close CTA.
- About 1–2 natural Florida Buzz references in a 12–15 minute episode (not a tool tour), plus the REQUIRED merch close beat.
- Say “The Florida Buzz dot com” when speaking; never read long URLs aloud.
- Do not interrupt a thoughtful observation with a promotion.
- REQUIRED close merch mention: Florida Buzz merch section + “I Caught a Buzz in Florida” t-shirts (soon-to-be-famous / fun energy OK; no hard sell; once only).
- REQUIRED close YouTube CTA: one short line asking people watching on YouTube to like and subscribe (natural, once, not pushy).
- REQUIRED mid-episode partner mention: after a couple of stories, include one short human line about partner ${PARTNER_NAME} for Disney tickets/hotels, disclose partner/affiliate nature, point listeners to the show notes link, and note that booking there helps support the show. No hard-sell spam; do not invent prices or deals.
- Soft outro: briefly remind that the ${PARTNER_NAME} link is in the show notes, then close.
- Closing may briefly mention listeners can find the stories at The Florida Buzz dot com — keep it short.
- STANDALONE EPISODE RULE (critical): Never say “Part 1”, “Part 2”, “to be continued”, or any multi-part tease. Close as a complete show with a normal goodbye.
- No forced comedy, no exaggerated/childish voices, no heavy accents, no announcer cadence.
- Write lines that sound spoken/reactive — contractions, fragments — not tidy prose paragraphs.

Return ONLY the segment markers + Geno dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} episode — complete on its own (not Part 1 or Part 2 of a larger show).
Written affiliation disclosure (show notes / RSS only — do NOT speak the word “unofficial”): ${AFFILIATION_DISCLOSURE}
Partner mid-roll direction: ${PODCAST_MIDROLL_DIRECTION}
Partner soft outro direction: ${PODCAST_OUTRO_DIRECTION}

Outline:
${outline}

Approved sources (summarize in original language; do not invent news facts beyond these notes):
${sourceBlock || '(none — do not invent dated news)'}

Verified Florida Buzz tools (mention lightly near close only if natural; do not demo planner tips):
${verifiedToolsBlock()}

Length requirement: produce a full ~12–15 minute solo Geno episode script of about ${CONVERSATION_MIN_WORDS}–${CONVERSATION_TARGET_MAX_WORDS} spoken words (Geno lines only). REQUIRED open: short Geno Option A — welcome to the Florida Buzz Disney podcast / I'm your host Geno / thank you for joining us (or being here / listening) / what's happening at Disney World / let's go — before stories. Never say “unofficial.” Never open with the eighteen-months longevity monologue. Talk about the news like a person across the table — mixed feelings OK, skepticism OK, no vacation-planning lectures. Structure: 4–6 story segments + short ${PARTNER_NAME} mid-roll + close that includes the merch section / “I Caught a Buzz in Florida” t-shirts mention + soft ${PARTNER_NAME} show-notes reminder. Include === SEGMENT: … === markers. End with a full standalone wrap-up and goodbye — never tease Part 2.`,
  };
}

async function generateOutline({ aiText, show, episode, sources }) {
  const prompt = buildOutlinePrompt({ show, episode, sources });
  const text = await aiText.generateText(prompt.system, prompt.user, 2000, CONVERSATION_REQUEST_TIMEOUT_MS);
  return String(text || '').trim();
}

async function generateConversation({ aiText, show, episode, outline, sources }) {
  const prompt = buildConversationPrompt({ show, episode, outline, sources });
  let script = String(
    await aiText.generateText(prompt.system, prompt.user, CONVERSATION_MAX_OUTPUT_TOKENS, CONVERSATION_REQUEST_TIMEOUT_MS)
  ).trim();

  let continueAttempt = 0;
  while (countScriptWords(script) < CONVERSATION_MIN_WORDS && continueAttempt < CONVERSATION_CONTINUE_ATTEMPTS) {
    continueAttempt += 1;
    const words = countScriptWords(script);
    const continuation = String(
      await aiText.generateText(
        `You continue an unfinished Florida Buzz Disney solo podcast script.
Keep the exact "Geno:" line format and === SEGMENT: slug === markers when starting a new story.
Keep light calm ElevenLabs audio tags (roughly every other Geno line; e.g. Geno: [chuckles] …, Geno: [conversational] …). Prefer [warmly], [conversational], [chuckles], [laughs], [sighs], [nostalgic], [thoughtful]. Avoid [excited] / [upbeat]. Do not stack tags.
Write fewer, longer breath-group lines with … and — for micro-pauses. Talk about Disney World news like someone sitting across the table — mixed feelings OK, skepticism OK. No announcer polish, no vacation-planning lectures, never say “unofficial,” never state Geno's age in years, never invent personal park-day anecdotes.
HARD BAN “Full stop.”, “the mistake is…”, “you are allowed…”, bossy don't-chains, “Been around enough…”, scolding guests, and stacked everybody/somebody hotel-chaos lists.
Do not restart the episode or repeat the named open.
Continue naturally from the last lines until the full episode reaches about 12–15 minutes (~1800–2400 spoken words).
Preserve news-roundup solo style (4–6 stories + mid-roll + close) and Florida Buzz source accuracy rules.
Never introduce Gena/Diane dual-host lines.`,
        `Spoken words so far: ${words}. Need at least ${CONVERSATION_MIN_WORDS}.
Continue this script:\n\n${script.slice(-12000)}`,
        CONVERSATION_MAX_OUTPUT_TOKENS,
        CONVERSATION_REQUEST_TIMEOUT_MS
      )
    ).trim();
    script = appendContinuation(script, continuation);
  }

  if (!/^Geno:/m.test(script)) {
    throw new Error('Generated script must include Geno: dialogue lines');
  }
  if (/^(Gena|Diane):/m.test(script)) {
    throw new Error('Generated script must be solo Geno — remove Gena:/Diane: dual-host lines');
  }
  assertScriptOpenShape(script);
  const words = countScriptWords(script);
  if (words < CONVERSATION_MIN_WORDS) {
    throw new Error(
      `Generated script is too short for a ~12–15 minute episode (${words} words; need at least ${CONVERSATION_MIN_WORDS}). Increase PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS or retry.`
    );
  }
  return script;
}

/**
 * Pack solo host lines into TTS chunks.
 * Prefer === SEGMENT: … === markers so each story can be regenerated independently.
 * Fall back to size-based packing when markers are absent.
 */
function splitScriptIntoSections(scriptText, maxChars, { minTurns = 4 } = {}) {
  const lines = String(scriptText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Script is empty');

  const marked = [];
  let bucket = [];
  for (const line of lines) {
    if (SEGMENT_MARKER_RE.test(line)) {
      if (bucket.length) marked.push(bucket.join('\n'));
      bucket = [];
      continue; // markers are structural only — do not speak them
    }
    bucket.push(line);
  }
  if (bucket.length) marked.push(bucket.join('\n'));
  if (marked.length >= 2) {
    return marked.filter(Boolean);
  }

  const softMax = Math.max(500, Number(maxChars) || 4000);
  const hardMax = Math.floor(softMax * 1.2);
  const minKeep = Math.max(2, Number(minTurns) || 4);
  const sections = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    if (SEGMENT_MARKER_RE.test(line)) continue;
    const add = line.length + 1;
    const wouldExceedSoft = current.length && size + add > softMax;
    const wouldExceedHard = current.length && size + add > hardMax;
    const enoughTurns = current.length >= minKeep;
    if (wouldExceedHard || (wouldExceedSoft && enoughTurns)) {
      sections.push(current.join('\n'));
      current = [line];
      size = add;
    } else {
      current.push(line);
      size += add;
    }
  }
  if (current.length) sections.push(current.join('\n'));
  if (sections.length >= 2) {
    const last = sections[sections.length - 1];
    const prev = sections[sections.length - 2];
    const lastTurns = last.split('\n').length;
    if (lastTurns < Math.min(3, minKeep) && prev.length + 1 + last.length <= hardMax) {
      sections[sections.length - 2] = `${prev}\n${last}`;
      sections.pop();
    }
  }
  return sections;
}

/**
 * Format a script section for TTS.
 * ElevenLabs solo: strip Geno:/Gena:/Diane: prefixes only.
 * CRITICAL: preserve ElevenLabs square-bracket audio tags ([conversational],
 * [warmly], [chuckles], etc.) — never strip [...] before sending to the TTS API.
 * fal multi-speaker fallback may still want SpeakerId prefixes — pass keepSpeakerPrefix.
 */
function formatScriptForTts(sectionText, { keepSpeakerPrefix = false } = {}) {
  const lines = String(sectionText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !SEGMENT_MARKER_RE.test(line))
    .map((line) => {
      if (keepSpeakerPrefix) return line;
      // Host label only — leave [audio tags] intact for eleven_v3 / eleven_v4.
      return line.replace(/^(Geno|Gena|Diane):\s*/i, '');
    })
    .filter(Boolean);
  return lines.join('\n');
}

module.exports = {
  DISCLOSURE,
  AFFILIATION_DISCLOSURE,
  HOST_BIBLE,
  GENO_NAMED_OPEN_OPTION_A,
  ELEVENLABS_AUDIO_TAGS_GUIDANCE,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_MIN_WORDS,
  CONVERSATION_TARGET_MAX_WORDS,
  CONVERSATION_REQUEST_TIMEOUT_MS,
  countScriptWords,
  assertScriptOpenShape,
  appendContinuation,
  buildOutlinePrompt,
  buildConversationPrompt,
  generateOutline,
  generateConversation,
  splitScriptIntoSections,
  formatScriptForTts,
  SEGMENT_MARKER_RE,
};
