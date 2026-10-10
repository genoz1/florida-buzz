'use strict';

const {
  AFFILIATION_DISCLOSURE,
  AI_ANECDOTE_DISCLOSURE,
  HOST_BIBLE,
} = require('./hosts');

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
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, or dates. Those must come from approved source material only.
- When source notes lack a dated park detail, plan timeless composite experiences — do not claim a specific date.
- No Disney affiliation or inside-access claims.
- No forced comedy or presenter/host-read tone.
- Do not recycle the same experiences, jokes, family details, or sentence patterns from a generic template; invent fresh specifics for this episode.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Included sources (approved weekly material — factual base only):
${sourceBlock || '(none yet — use timeless composite experiences only; invent no dated news facts)'}

Write a concise segment outline for a 10–20 minute conversation with 2–3 topic-linked personal anecdote beats and at least one callback note.`,
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
- Sound like Central Florida moms who regularly visit the parks — not presenters summarizing articles.
- Cover approved source topics accurately, but weave them into friend talk, opinions, and reactions.
- Include two or three brief recent-park-experience stories connected directly to the episode topics.
- Make stories specific and conversational with small believable details; keep each anecdote concise.
- The other host must react: ask a follow-up, laugh, disagree, interrupt briefly, or relate a similar experience.
- Include at least one natural callback later in the episode to an earlier anecdote or detail.
- Do not make every anecdote neatly resolve into a scripted lesson.
- Avoid repeating the same experiences, jokes, family details, or sentence patterns across episodes; invent fresh specifics each time.
- Never invent breaking-news facts, exact current wait times, closures, prices, policies, or dates. Use only approved source material for those facts.
- When no factual park notes are available, use timeless composite experiences rather than claiming something happened on a specific date.
- Always spell Gena (never Gina). Do not write phonetic pronunciations in dialogue.
- Mention the unofficial-fan affiliation disclosure once near the open.
- Do not read the AI/anecdote show-notes disclosure aloud unless a host naturally jokes that stories can be a little dramatized — optional, rare, never formal.
- End with a light sign-off pointing listeners to TheFloridaBuzz.com
- No forced comedy, no constant agreement, no exaggerated/childish voices, no heavy accents, no announcer cadence.

Return ONLY the dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Affiliation disclosure to include once near the open: ${AFFILIATION_DISCLOSURE}
Show-notes AI disclosure (do not read verbatim unless a rare natural aside fits): ${AI_ANECDOTE_DISCLOSURE}

Outline:
${outline}

Approved sources (summarize in original language; do not invent news facts beyond these notes):
${sourceBlock || '(none — timeless composites only; no dated claims)'}`,
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
