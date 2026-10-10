'use strict';

const {
  AFFILIATION_DISCLOSURE,
  AI_ANECDOTE_DISCLOSURE,
  HOST_BIBLE,
} = require('./hosts');
const { verifiedToolsBlock } = require('./siteResources');

// Back-compat export name used by older imports/tests.
const DISCLOSURE = AFFILIATION_DISCLOSURE;

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
- Shape a conversation between friends, not a news rundown or article roundup.
- Cover each included source topic accurately using only facts from the source notes.
- Separate verified source facts from host opinions and personal anecdotes.
- Plan exactly 2–3 brief "recent park experience" anecdote beats tied directly to episode topics.
- Anecdotes may involve Geno or Michael, long waits, parking, transportation, weather, mobile ordering, tired kids, crowds, cast members, or something amusing another guest did.
- Mark anecdote beats clearly (e.g. "Anecdote:") and note a later callback opportunity when natural.
- Plan 3–5 natural Florida Buzz resource mentions across the episode (not ads): at least one near the open, one or more in the main discussion, and a brief CTA near the close.
- Mark resource beats (e.g. "Resource:") naming only verified tools/articles from the lists below, with a one-line note on how it helps the listener.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, or URLs. Those must come from approved source material / verified tools only.
- When source notes lack a dated park detail, plan timeless composite experiences — do not claim a specific date.
- Do not place a promotion inside an emotional, humorous, or personal anecdote beat.
- No Disney affiliation or inside-access claims.
- No forced comedy or presenter/host-read tone.
- Do not recycle the same experiences, jokes, family details, or sentence patterns from a generic template; invent fresh specifics for this episode.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Included sources (approved weekly material — factual base only):
${sourceBlock || '(none yet — use timeless composite experiences only; invent no dated news facts)'}

Verified Florida Buzz tools hosts may recommend (only these site tools; plus included source articles/guides/Buzz Board links above):
${verifiedToolsBlock()}

Write a segment outline for an approximately 25–35 minute conversation with 2–3 topic-linked personal anecdote beats, 3–5 Florida Buzz resource beats, and at least one callback note.`,
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
- Target roughly 25–35 minutes of natural dialogue (substantive, not rushed; not padded filler).
- Sound like Central Florida moms who regularly visit the parks — not presenters summarizing articles.
- Cover approved source topics accurately, but weave them into friend talk, opinions, and reactions.
- Clearly distinguish factual information from personal opinion when discussing prices, policies, hours, attraction status, or wait times — those facts must come only from approved/current sources.
- Confirm time-sensitive details against approved source notes before stating them as fact; if unsure, speak generally or as opinion.
- When Buzz Board questions are included: paraphrase as needed, never invent community answers/usernames/votes, offer differing host opinions, and invite listeners to visit the Buzz Board.
- Include two or three brief recent-park-experience stories connected directly to the episode topics.
- Make stories specific and conversational with small believable details; keep each anecdote concise.
- The other host must react: ask a follow-up, laugh, disagree, interrupt briefly, or relate a similar experience.
- Include at least one natural callback later in the episode to an earlier anecdote or detail.
- Do not make every anecdote neatly resolve into a scripted lesson.
- Avoid repeating the same experiences, jokes, family details, or sentence patterns across episodes; invent fresh specifics each time.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, dates, guides, features, URLs, or offerings. Use only approved sources and verified Florida Buzz tools.
- When no factual park notes are available, use timeless composite experiences rather than claiming something happened on a specific date.
- Always spell Gena (never Gina). Do not write phonetic pronunciations in dialogue.
- Mention the unofficial-fan affiliation disclosure once near the open.
- Do not read the AI/anecdote show-notes disclosure aloud unless a host naturally jokes that stories can be a little dramatized — optional, rare, never formal.

Florida Buzz listener guidance (helpful, not ad-read):
- Naturally reference relevant Florida Buzz content/tools throughout: the specific articles being discussed, planning guides, the dining guide, wait times, the day planner, Buzz Board discussions, and any other verified Florida Buzz resource tied to the topic.
- About 3–5 natural Florida Buzz references in a 25–35 minute episode.
- At least one useful recommendation near the beginning, one or more during the main discussion, and a brief call to action near the end.
- When an article or resource’s information is discussed, name that Florida Buzz piece and briefly explain how it helps the listener — not a bare “go check our site.”
- Vary the wording so references do not sound like repeated advertisements.
- Let the other host respond naturally (e.g. how she’d use the day planner, dining guide, or wait times with her family).
- Say “The Florida Buzz dot com” when speaking; never read long URLs aloud.
- Do not interrupt an emotional, humorous, or personal moment with a promotion.
- Closing must include a concise conversational reminder that listeners can find the articles, guides, dining information, wait times, day planner, and community discussions at The Florida Buzz dot com.
- No forced comedy, no constant agreement, no exaggerated/childish voices, no heavy accents, no announcer cadence.

Return ONLY the dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Affiliation disclosure to include once near the open: ${AFFILIATION_DISCLOSURE}
Show-notes AI disclosure (do not read verbatim unless a rare natural aside fits): ${AI_ANECDOTE_DISCLOSURE}

Outline:
${outline}

Approved sources (summarize in original language; do not invent news facts beyond these notes):
${sourceBlock || '(none — timeless composites only; no dated claims)'}

Verified Florida Buzz tools (promote only these site tools, plus the approved sources above):
${verifiedToolsBlock()}`,
  };
}

async function generateOutline({ aiText, show, episode, sources }) {
  const prompt = buildOutlinePrompt({ show, episode, sources });
  const text = await aiText.generateText({
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: 1400,
  });
  return String(text || '').trim();
}

async function generateConversation({ aiText, show, episode, outline, sources }) {
  const prompt = buildConversationPrompt({ show, episode, outline, sources });
  const text = await aiText.generateText({
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: 4500,
  });
  const script = String(text || '').trim();
  if (!/^Gena:/m.test(script) || !/^Diane:/m.test(script)) {
    throw new Error('Generated script must include Gena: and Diane: dialogue lines');
  }
  return script;
}

function splitScriptIntoSections(scriptText, maxChars) {
  const lines = String(scriptText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Script is empty');
  const sections = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const add = line.length + 1;
    if (current.length && size + add > maxChars) {
      sections.push(current.join('\n'));
      current = [line];
      size = add;
    } else {
      current.push(line);
      size += add;
    }
  }
  if (current.length) sections.push(current.join('\n'));
  return sections;
}

function formatScriptForTts(sectionText) {
  // fal multi-speaker expects "SpeakerId: text" prefixes matching speakers[].speaker_id
  return String(sectionText || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  DISCLOSURE,
  AFFILIATION_DISCLOSURE,
  AI_ANECDOTE_DISCLOSURE,
  HOST_BIBLE,
  buildOutlinePrompt,
  buildConversationPrompt,
  generateOutline,
  generateConversation,
  splitScriptIntoSections,
  formatScriptForTts,
};
