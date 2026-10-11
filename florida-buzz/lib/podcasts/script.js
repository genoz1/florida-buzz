'use strict';

const {
  AFFILIATION_DISCLOSURE,
  HOST_BIBLE,
} = require('./hosts');
const { verifiedToolsBlock } = require('./siteResources');

// Back-compat export name used by older imports/tests.
const DISCLOSURE = AFFILIATION_DISCLOSURE;

// Target ~20–25 minutes per episode for twice-weekly publishing (~150 wpm → ~3,000–3,800 words).
// Output-token headroom must stay above that so Responses API does not truncate.
const CONVERSATION_MAX_OUTPUT_TOKENS = Number(process.env.PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS || 16000);
const CONVERSATION_MIN_WORDS = Number(process.env.PODCASTS_SCRIPT_MIN_WORDS || 3000);
const CONVERSATION_TARGET_MAX_WORDS = Number(process.env.PODCASTS_SCRIPT_TARGET_MAX_WORDS || 3800);
const CONVERSATION_REQUEST_TIMEOUT_MS = Number(process.env.PODCASTS_SCRIPT_TIMEOUT_MS || 420000);
const CONVERSATION_CONTINUE_ATTEMPTS = Number(process.env.PODCASTS_SCRIPT_CONTINUE_ATTEMPTS || 2);

function countScriptWords(scriptText) {
  return String(scriptText || '')
    .replace(/^Gena:\s*/gim, ' ')
    .replace(/^Diane:\s*/gim, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function appendContinuation(existing, continuation) {
  const base = String(existing || '').trim();
  let next = String(continuation || '').trim();
  if (!next) return base;
  // Drop accidental full restarts that repeat the warm open / episode restart.
  const looksLikeRestart =
    (/^Gena:\s*(Hey|Hi|Okay,? hey)/i.test(next) && /Florida Buzz/i.test(next.slice(0, 500))) ||
    (/welcome back to Florida Buzz/i.test(next.slice(0, 400)));
  if (looksLikeRestart) {
    const lines = next.split(/\n+/).filter((line) => line.trim());
    // Keep from first line that isn't an exact duplicate of an early base line.
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
- Always spell Gena (never Gina).
- Shape a lively aftershow-style conversation between friends, not a news rundown or article roundup — must feel unscripted / reactive, not written.
- Segment 1 MUST be a Warm Open (30–90 seconds when spoken): friend hello / life or recent-park catch-up banter — before any topic hook.
- Warm-open ideas: what they did since last episode, whether they went to a park, kid chaos, Geno/Michael plans, weather, parking, a small funny life detail.
- After Warm Open: Topic Hook → Affiliation Disclosure → main discussion. Never cold-open on the headline.
- Cover each included source topic accurately using only facts from the source notes.
- Separate verified source facts from host opinions and personal anecdotes.
- Plan exactly 2–3 brief "recent park experience" anecdote beats tied directly to episode topics (in addition to the warm-open banter).
- Anecdotes may involve Geno or Michael, long waits, parking, transportation, weather, mobile ordering, tired kids, crowds, cast members, or something amusing another guest did.
- Mark anecdote beats clearly (e.g. "Anecdote:") and note a later callback opportunity when natural.
- Plan 3–5 natural Florida Buzz resource mentions across the episode (not ads): at least one after the warm open / near the early topic, one or more in the main discussion, and a brief CTA near the close.
- Mark resource beats (e.g. "Resource:") naming only verified tools/articles from the lists below, with a one-line note on how it helps the listener.
- Anti-scripted energy notes per segment: ban tennis-match equal-length volleys; mix 1–6 word reactions, medium turns, and occasional longer rambles; soft interruptions / “wait—” pivots; mild disagreement — forbid tidy thesis→example→lesson segment shapes and equal-length polished host monologues.
- Prefer short punchy exchange beats over long equal-length host monologues — avoid polished symmetrical essay-dialogue.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, or URLs. Those must come from approved source material / verified tools only.
- When source notes lack a dated park detail, plan timeless composite experiences — do not claim a specific date.
- Do not place a promotion inside an emotional, humorous, or personal anecdote beat.
- No Disney affiliation or inside-access claims.
- No forced comedy or presenter/host-read tone.
- Do not recycle the same experiences, jokes, family details, or sentence patterns from a generic template; invent fresh specifics for this episode.
- This is ONE standalone episode. Never outline “Part 1”, “Part 2”, “to be continued”, or a tease for another half of the same show.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} — this is a complete episode, not a multi-part show.
Included sources (approved weekly material — factual base only):
${sourceBlock || '(none yet — use timeless composite experiences only; invent no dated news facts)'}

Verified Florida Buzz tools hosts may recommend (only these site tools; plus included source articles/guides/Buzz Board links above):
${verifiedToolsBlock()}

Write a segment outline for an approximately 20–25 minute conversation (~3,000–3,800 spoken words when scripted). Start with Warm Open (30–90s friend hello / life or park banter), then topic hook + affiliation disclosure, then 2 topic-linked personal anecdote beats, 2–4 Florida Buzz resource beats, and at least one callback note. Mark anti-scripted exchange energy (no tennis-match equal turns; mix 1–6 word reactions / medium / occasional rambles) on main segments. End with a full standalone close — never “see you in Part 2.”`,
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
Gena: ...
Diane: ...

${HOST_BIBLE}

Conversation requirements:
- Target roughly 20–25 minutes of natural dialogue (~3,000–3,800 spoken words; substantive, not rushed; not padded filler).
- Write a FULL episode script in one pass when possible — do not stop after a short warm open or a few topics.
- Sound like Central Florida moms who regularly visit the parks — not presenters summarizing articles, not reading a written essay aloud.
- Lean into lively aftershow/reaction energy (AfterBuzz-style bounce): shorter punchier turns, frequent reactions, excited overlap energy between hosts.
- ANTI-SCRIPTED HARD RULES (critical — listeners complained it still sounds written):
  - HARD BAN tennis-match equal-length turns: never alternate neat same-sized host volleys.
  - Turn lengths MUST be uneven. Require a mix of (1) frequent 1–6 word reactions (“yep,” “no way,” “wait—,” “oh my lord,” “same,” “heck yeah”), (2) medium turns, and (3) occasional longer rambles / story beats.
  - Include occasional mid-thought pivots, unfinished sentences, soft interruptions, and overlapping agreement energy (“right—” / “exactly—”).
  - Both hosts must NOT sound equally polished — one riffs messier / trails off; the other stacks quick reactions.
  - Allow mild disagreement and talking-over energy; forbid constant tidy agreement.
  - FORBID tidy thesis → example → lesson beats and neat moral wrap-ups after anecdotes.
  - FORBID polished symmetrical essay-dialogue (neat equal-length paragraphs alternating hosts).
  - Prefer capping most turns under ~40–50 spoken words unless a story beat truly needs a longer ramble.
- OPEN SHAPE (critical): Start with 30–90 seconds of warm friend hello / life or recent-park banter BEFORE the topic hook. Examples: “hey, how was your week,” whether they went to a park, kid chaos, Geno/Michael, weather, parking. Then transition into the topic hook. Then the unofficial affiliation disclosure. Never cold-open on the news headline (“Okay if you were calling EPCOT…” / “Okay we have resort news…” as line 1).
- Cover approved source topics accurately, but weave them into friend talk, opinions, and reactions.
- Clearly distinguish factual information from personal opinion when discussing prices, policies, hours, attraction status, or wait times — those facts must come only from approved/current sources.
- Confirm time-sensitive details against approved source notes before stating them as fact; if unsure, speak generally or as opinion.
- When Buzz Board questions are included: paraphrase as needed, never invent community answers/usernames/votes, offer differing host opinions, and invite listeners to visit the Buzz Board.
- Include two or three brief recent-park-experience stories connected directly to the episode topics (separate from the warm-open banter).
- Make stories specific and conversational with small believable details; keep each anecdote concise — and let the other host cut in before the story becomes a monologue.
- The other host must react quickly: ask a follow-up, laugh, disagree, interrupt briefly, drop a short affirmation (“yep,” “oh my lord,” “heck yeah,” “no way,” “wait—”), or relate a similar experience.
- Prefer many short/medium exchanges over one host speaking for long stretches.
- Uneven turn lengths are required: one host can ramble for a beat while the other fires 1–6 word reactions, then they flip — never tidy equal volleys.
- Include at least one natural callback later in the episode to an earlier anecdote or detail.
- Do not make every anecdote neatly resolve into a scripted lesson.
- Avoid repeating the same experiences, jokes, family details, or sentence patterns across episodes; invent fresh specifics each time.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, URLs, or offerings. Use only approved sources and verified Florida Buzz tools.
- When no factual park notes are available, use timeless composite experiences rather than claiming something happened on a specific date.
- Always spell Gena (never Gina). Do not write phonetic pronunciations in dialogue.
- Mention the unofficial-fan affiliation disclosure once near the open — AFTER the warm friend banter and topic hook is fine.
- Do not claim a live studio audience, callers, or TV panel format — keep it two hosts talking parks.

Florida Buzz listener guidance (helpful, not ad-read):
- Naturally reference relevant Florida Buzz content/tools throughout: the specific articles being discussed, planning guides, the dining guide, wait times, the day planner, Buzz Board discussions, and any other verified Florida Buzz resource tied to the topic.
- About 2–4 natural Florida Buzz references in a 20–25 minute episode.
- At least one useful recommendation near the beginning, one or more during the main discussion, and a brief call to action near the end.
- When an article or resource’s information is discussed, name that Florida Buzz piece and briefly explain how it helps the listener — not a bare “go check our site.”
- Vary the wording so references do not sound like repeated advertisements.
- Let the other host respond naturally (e.g. how she’d use the day planner, dining guide, or wait times with her family).
- Say “The Florida Buzz dot com” when speaking; never read long URLs aloud.
- Do not interrupt an emotional, humorous, or personal moment with a promotion.
- Closing must include a concise conversational reminder that listeners can find the articles, guides, dining information, wait times, day planner, and community discussions at The Florida Buzz dot com.
- STANDALONE EPISODE RULE (critical): Never say “Part 1”, “Part 2”, “part one”, “part two”, “before we wrap Part 1”, “we have more in Part 2”, “see you in Part 2”, “to be continued”, or any multi-part tease. Close as a complete show with a normal goodbye. Another episode later in the week is a separate show with its own topics — do not reference it as a continuation.
- No forced comedy, no constant agreement, no exaggerated/childish voices, no heavy accents, no announcer cadence.
- Write lines that sound spoken/reactive — contractions, fragments, interruptions — not tidy prose paragraphs.

Return ONLY the dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Release framing: ${episode.release_label || 'standalone'} episode — complete on its own (not Part 1 or Part 2 of a larger show).
Affiliation disclosure to include once near the open: ${AFFILIATION_DISCLOSURE}

Outline:
${outline}

Approved sources (summarize in original language; do not invent news facts beyond these notes):
${sourceBlock || '(none — timeless composites only; no dated claims)'}

Verified Florida Buzz tools (promote only these site tools, plus the approved sources above):
${verifiedToolsBlock()}

Length requirement: produce a full ~20–25 minute episode script of about ${CONVERSATION_MIN_WORDS}–${CONVERSATION_TARGET_MAX_WORDS} spoken words (Gena/Diane dialogue only). Open with 30–90 seconds of warm friend hello/life or park banter before the topic hook — do not return a short teaser or a cold topic open. Keep turns uneven (ban tennis-match equal volleys; mix 1–6 word reactions, medium turns, occasional longer rambles) so it does not sound scripted. End with a full standalone wrap-up and goodbye — never tease Part 2.`,
  };
}

async function generateOutline({ aiText, show, episode, sources }) {
  const prompt = buildOutlinePrompt({ show, episode, sources });
  // Florida Buzz aiText.generateText(system, user, maxTokens[, timeoutMs]) — positional args only.
  const text = await aiText.generateText(prompt.system, prompt.user, 2000, CONVERSATION_REQUEST_TIMEOUT_MS);
  return String(text || '').trim();
}

async function generateConversation({ aiText, show, episode, outline, sources }) {
  const prompt = buildConversationPrompt({ show, episode, outline, sources });
  // Florida Buzz aiText.generateText(system, user, maxTokens[, timeoutMs]) — positional args only.
  let script = String(
    await aiText.generateText(prompt.system, prompt.user, CONVERSATION_MAX_OUTPUT_TOKENS, CONVERSATION_REQUEST_TIMEOUT_MS)
  ).trim();

  let continueAttempt = 0;
  while (countScriptWords(script) < CONVERSATION_MIN_WORDS && continueAttempt < CONVERSATION_CONTINUE_ATTEMPTS) {
    continueAttempt += 1;
    const words = countScriptWords(script);
    const continuation = String(
      await aiText.generateText(
        `You continue an unfinished Florida Buzz: Disney podcast script.
Keep the exact "Gena:" / "Diane:" line format.
Do not restart the episode or repeat the warm open / hello banter.
Continue naturally from the last lines until the full episode reaches about 20–25 minutes (~3000–3800 spoken words).
Preserve host bible anti-scripted aftershow energy (no tennis-match equal turns; mix 1–6 word reactions / medium / occasional rambles; soft interruptions; mild disagreement — not polished essay-dialogue) and Florida Buzz source accuracy rules.`,
        `Spoken words so far: ${words}. Need at least ${CONVERSATION_MIN_WORDS}.
Continue this script:\n\n${script.slice(-12000)}`,
        CONVERSATION_MAX_OUTPUT_TOKENS,
        CONVERSATION_REQUEST_TIMEOUT_MS
      )
    ).trim();
    script = appendContinuation(script, continuation);
  }

  if (!/^Gena:/m.test(script) || !/^Diane:/m.test(script)) {
    throw new Error('Generated script must include Gena: and Diane: dialogue lines');
  }
  const words = countScriptWords(script);
  if (words < CONVERSATION_MIN_WORDS) {
    throw new Error(
      `Generated script is too short for a ~20–25 minute episode (${words} words; need at least ${CONVERSATION_MIN_WORDS}). Increase PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS or retry.`
    );
  }
  return script;
}

/**
 * Pack dialogue into larger multi-turn TTS chunks.
 * Prefer keeping several host exchanges together so fal paces a real conversation
 * instead of many tiny one-line-at-a-time sections with identical seams.
 */
function splitScriptIntoSections(scriptText, maxChars, { minTurns = 8 } = {}) {
  const lines = String(scriptText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Script is empty');
  const softMax = Math.max(500, Number(maxChars) || 5600);
  // Allow a little overflow so we do not cut a short reaction volley off mid-exchange.
  const hardMax = Math.floor(softMax * 1.2);
  const minKeep = Math.max(2, Number(minTurns) || 8);
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
  // Absorb a tiny trailing section into the previous chunk when possible (fewer seams).
  if (sections.length >= 2) {
    const last = sections[sections.length - 1];
    const prev = sections[sections.length - 2];
    const lastTurns = last.split('\n').length;
    if (lastTurns < Math.min(4, minKeep) && prev.length + 1 + last.length <= hardMax) {
      sections[sections.length - 2] = `${prev}\n${last}`;
      sections.pop();
    }
  }
  return sections;
}

function formatScriptForTts(sectionText) {
  // fal multi-speaker expects "SpeakerId: text" prefixes matching speakers[].speaker_id.
  // Keep turns on separate lines (required), but do not insert blank lines between them —
  // blank lines encourage identical dead-air gaps between every host statement.
  return String(sectionText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  DISCLOSURE,
  AFFILIATION_DISCLOSURE,
  HOST_BIBLE,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_MIN_WORDS,
  CONVERSATION_TARGET_MAX_WORDS,
  CONVERSATION_REQUEST_TIMEOUT_MS,
  countScriptWords,
  appendContinuation,
  buildOutlinePrompt,
  buildConversationPrompt,
  generateOutline,
  generateConversation,
  splitScriptIntoSections,
  formatScriptForTts,
};
