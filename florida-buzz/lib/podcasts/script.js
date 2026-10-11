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

// Target ~20–25 minutes per episode for twice-weekly publishing (~150 wpm → ~3,000–3,800 words).
const CONVERSATION_MAX_OUTPUT_TOKENS = Number(process.env.PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS || 16000);
const CONVERSATION_MIN_WORDS = Number(process.env.PODCASTS_SCRIPT_MIN_WORDS || 3000);
const CONVERSATION_TARGET_MAX_WORDS = Number(process.env.PODCASTS_SCRIPT_TARGET_MAX_WORDS || 3800);
const CONVERSATION_REQUEST_TIMEOUT_MS = Number(process.env.PODCASTS_SCRIPT_TIMEOUT_MS || 420000);
const CONVERSATION_CONTINUE_ATTEMPTS = Number(process.env.PODCASTS_SCRIPT_CONTINUE_ATTEMPTS || 2);

function countScriptWords(scriptText) {
  return String(scriptText || '')
    .replace(/^Geno:\s*/gim, ' ')
    .replace(/^Gena:\s*/gim, ' ')
    .replace(/^Diane:\s*/gim, ' ')
    .replace(ELEVENLABS_AUDIO_TAG_RE, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Hard-require Geno Option A named open before topic hooks / weather essays.
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
  if (!/I['’]?m Geno/i.test(headText)) {
    throw new Error('Script open must include I\'m Geno in the first spoken lines');
  }
  if (!/welcome to Florida Buzz(?::?\s*Disney)?/i.test(headText)) {
    throw new Error('Script open must welcome listeners to Florida Buzz: Disney');
  }
  if (!/unofficial/i.test(earlyText)) {
    throw new Error('Script open must mention this is an unofficial fan show');
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
- Shape a lively solo energetic briefing, not a news rundown or dual-host chat — must feel unscripted / reactive, not written.
- Segment 1 MUST be Named Open and MUST list Geno Option A beats explicitly before any topic hook:
  1) Welcome to Florida Buzz: Disney
  2) I'm Geno — unofficial fan host from The Florida Buzz
  3) Not affiliated with Disney — just a fan
  4) Lock in park-day energy / cut through the noise
  5) Let's go
- Plan sparse-to-moderate ElevenLabs audio tags on spoken beats across the episode (Named Open keeps [excited]/[warmly]; mark a few Quick Hits / Deep Dive / CTA lines with [chuckles], [upbeat], [nostalgic], [conversational], etc. where natural).
- After Named Open: Quick Hits (several short sourced topics) → short ${PARTNER_NAME} partner mid-roll → one Deep Dive → CTA / close with Florida Buzz resources + soft ${PARTNER_NAME} show-notes reminder + affiliation if needed.
- HARD BAN Segment 1 dual-host intros or weather-only cold opens that skip I'm Geno + welcome + unofficial + Let's go.
- Cover each included source topic accurately using only facts from the source notes.
- Separate verified source facts from host opinions and personal anecdotes.
- Plan exactly 1–2 brief "recent park experience" anecdote beats tied to the deep dive (or one quick hit).
- Plan 3–5 natural Florida Buzz resource mentions across the episode (not ads): at least one early, one in the deep dive, and a CTA near the close.
- REQUIRED Partner mid-roll segment (mark as "Partner mid-roll:"): ${PODCAST_MIDROLL_DIRECTION}
- REQUIRED Soft outro partner reminder in the close (mark as "Partner outro:"): ${PODCAST_OUTRO_DIRECTION}
- Mark resource beats (e.g. "Resource:") naming only verified tools/articles from the lists below.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, or URLs.
- When source notes lack a dated park detail, plan timeless composite experiences — do not claim a specific date.
- Do not place a promotion inside an emotional, humorous, or personal anecdote beat.
- No Disney affiliation or inside-access claims.
- This is ONE standalone episode. Never outline “Part 1”, “Part 2”, or a tease for another half of the same show.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} — this is a complete episode, not a multi-part show.
Included sources (approved weekly material — factual base only):
${sourceBlock || '(none yet — use timeless composite experiences only; invent no dated news facts)'}

Verified Florida Buzz tools hosts may recommend (only these site tools; plus included source articles/guides/Buzz Board links above):
${verifiedToolsBlock()}

Write a segment outline for an approximately 20–25 minute solo Geno episode (~3,000–3,800 spoken words when scripted). Segment 1 Named Open MUST be Geno Option A (welcome / I'm Geno / unofficial / let's go). Then Quick Hits, a short ${PARTNER_NAME} partner mid-roll, one Deep Dive, Florida Buzz resource beats, a soft ${PARTNER_NAME} show-notes reminder, and a full standalone close — never “see you in Part 2.”`,
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
Geno: [excited] Welcome to Florida Buzz: Disney. I'm Geno...
Geno: [chuckles] Okay, this next one's a classic park-day trap...

${HOST_BIBLE}

${ELEVENLABS_AUDIO_TAGS_GUIDANCE}

Conversation requirements:
- Target roughly 20–25 minutes of natural solo talk (~3,000–3,800 spoken words; substantive, not rushed; not padded filler).
- Write a FULL episode script in one pass when possible — do not stop after a short open or a few topics.
- Sound like a Central Florida park-day host who regularly visits the parks — not a presenter summarizing articles, not reading a written essay aloud.
- Trailer-style expressiveness: the spoken script MUST include sparse-to-moderate ElevenLabs audio tags so eleven_v4 TTS has delivery cues (not a flat dense monologue with zero tags).
- SOLO STRUCTURE (critical):
  1) Named Open — Geno Option A (exact intent; wording may match closely; keep audio tags):
     Geno: ${GENO_NAMED_OPEN_OPTION_A}
  2) Quick Hits — several short sourced topics with punchy takes (tag a few lines where energy shifts)
  3) Partner mid-roll — SHORT (~15–25 seconds): ${PODCAST_MIDROLL_DIRECTION}
  4) One Deep Dive — longer planning opinion + one brief park anecdote (use [nostalgic]/[sighs]/[chuckles] where natural)
  5) CTA / close — The Florida Buzz dot com resources + soft ${PARTNER_NAME} show-notes reminder + warm goodbye ([warmly] / [upbeat] near the close is good)
- HARD BAN dual-host dialogue (no Gena:/Diane: lines, no cohost reactions).
- HARD BAN opening with "Okay, how was your week" weather essays that skip I'm Geno + welcome + unofficial + Let's go.
- HARD BAN writing a full episode with no square-bracket audio tags after the open.
- Cover approved source topics accurately, but weave them into energetic host talk, opinions, and reactions.
- Clearly distinguish factual information from personal opinion when discussing prices, policies, hours, attraction status, or wait times — those facts must come only from approved/current sources.
- When Buzz Board questions are included: paraphrase as needed, never invent community answers/usernames/votes, offer Geno's take, and invite listeners to visit the Buzz Board.
- Include one or two brief recent-park-experience stories connected directly to the episode topics.
- Uneven pacing is good: mix short punchy hits with longer deep-dive stretches; allow mid-thought pivots and unfinished sentences.
- Mention the unofficial-fan affiliation in the named open (Option A already covers it); do not bury the show identity.
- Do not claim a live studio audience, callers, or TV panel format.

Florida Buzz listener guidance (helpful, not ad-read):
- Naturally reference relevant Florida Buzz content/tools throughout: the specific articles being discussed, planning guides, the dining guide, wait times, the day planner, Buzz Board discussions, and any other verified Florida Buzz resource tied to the topic.
- About 2–4 natural Florida Buzz references in a 20–25 minute episode.
- At least one useful recommendation near the beginning, one or more during the deep dive, and a brief call to action near the end.
- Say “The Florida Buzz dot com” when speaking; never read long URLs aloud.
- Do not interrupt an emotional, humorous, or personal moment with a promotion.
- REQUIRED mid-episode partner mention: after Quick Hits (before the Deep Dive), include one short human line about partner ${PARTNER_NAME} for Disney tickets/hotels, disclose partner/affiliate nature, point listeners to the show notes link, and note that booking there helps support the show. No hard-sell spam; do not invent prices or deals.
- Soft outro: briefly remind that the ${PARTNER_NAME} link is in the show notes, then close.
- Closing must include a concise conversational reminder that listeners can find the articles, guides, dining information, wait times, day planner, and community discussions at The Florida Buzz dot com.
- STANDALONE EPISODE RULE (critical): Never say “Part 1”, “Part 2”, “to be continued”, or any multi-part tease. Close as a complete show with a normal goodbye.
- No forced comedy, no exaggerated/childish voices, no heavy accents, no announcer cadence.
- Write lines that sound spoken/reactive — contractions, fragments — not tidy prose paragraphs.

Return ONLY the dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} episode — complete on its own (not Part 1 or Part 2 of a larger show).
Affiliation disclosure (already woven into Geno Option A open; keep consistent): ${AFFILIATION_DISCLOSURE}
Partner mid-roll direction: ${PODCAST_MIDROLL_DIRECTION}
Partner soft outro direction: ${PODCAST_OUTRO_DIRECTION}

Outline:
${outline}

Approved sources (summarize in original language; do not invent news facts beyond these notes):
${sourceBlock || '(none — timeless composites only; no dated claims)'}

Verified Florida Buzz tools (promote only these site tools, plus the approved sources above):
${verifiedToolsBlock()}

Length requirement: produce a full ~20–25 minute solo Geno episode script of about ${CONVERSATION_MIN_WORDS}–${CONVERSATION_TARGET_MAX_WORDS} spoken words (Geno lines only). REQUIRED open: Geno Option A — welcome / I'm Geno / unofficial / let's go — before quick hits. Structure: quick hits + short ${PARTNER_NAME} mid-roll + one deep dive + CTA with soft ${PARTNER_NAME} show-notes reminder. End with a full standalone wrap-up and goodbye — never tease Part 2.`,
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
        `You continue an unfinished Florida Buzz: Disney solo podcast script.
Keep the exact "Geno:" line format.
Keep sparse-to-moderate ElevenLabs audio tags on spoken beats where natural (e.g. Geno: [chuckles] …, Geno: [upbeat] …). Prefer [warmly], [excited], [chuckles], [laughs], [sighs], [conversational], [upbeat], [nostalgic]. Do not stack many tags on one line.
Do not restart the episode or repeat the named open.
Continue naturally from the last lines until the full episode reaches about 20–25 minutes (~3000–3800 spoken words).
Preserve solo energetic host style (quick hits + deep dive + CTA) and Florida Buzz source accuracy rules.
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
      `Generated script is too short for a ~20–25 minute episode (${words} words; need at least ${CONVERSATION_MIN_WORDS}). Increase PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS or retry.`
    );
  }
  return script;
}

/**
 * Pack solo host lines into TTS chunks.
 * Prefer keeping several beats together so seams stay natural.
 */
function splitScriptIntoSections(scriptText, maxChars, { minTurns = 6 } = {}) {
  const lines = String(scriptText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Script is empty');
  const softMax = Math.max(500, Number(maxChars) || 4000);
  const hardMax = Math.floor(softMax * 1.2);
  const minKeep = Math.max(2, Number(minTurns) || 6);
  const sections = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
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
 * CRITICAL: preserve ElevenLabs square-bracket audio tags ([excited], [warmly],
 * [chuckles], etc.) — never strip [...] before sending to the TTS API.
 * fal multi-speaker fallback may still want SpeakerId prefixes — pass keepSpeakerPrefix.
 */
function formatScriptForTts(sectionText, { keepSpeakerPrefix = false } = {}) {
  const lines = String(sectionText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
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
};
