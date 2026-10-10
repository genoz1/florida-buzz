'use strict';

const DISCLOSURE =
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

function buildOutlinePrompt({ show, episode, sources }) {
  const sourceBlock = sources
    .filter((s) => s.included)
    .map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}\n   Notes: ${s.summary || '(none)'}`)
    .join('\n');
  return {
    system: `You outline episodes for "${show.title}" from The Florida Buzz.
Hosts: Gena (guides the episode; spelled Gena, pronounced like Gina) and Diane (equal cohost).
Rules:
- Always spell the host name Gena (never Gina) in outlines and names.
- Summarize source stories in original language; never copy large article passages.
- Separate verified facts from host opinions.
- No Disney affiliation or inside-access claims.
- No forced comedy.
Return plain text outline with numbered segments.`,
    user: `Episode title: ${episode.title}
Episode description: ${episode.description}
Included sources:
${sourceBlock || '(none yet)'}

Write a concise segment outline for a 10–20 minute conversation.`,
  };
}

function buildConversationPrompt({ show, episode, outline, sources }) {
  const sourceBlock = sources
    .filter((s) => s.included)
    .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
    .join('\n');
  return {
    system: `You write natural podcast scripts for "${show.title}".
Format every spoken line as:
Gena: ...
Diane: ...

Naming:
- Always spell the host name Gena (never Gina) in speaker labels and spoken dialogue.
- Pronunciation for TTS: Gena sounds like Gina (JEEN-uh). Do not write phonetic respellings in the script.

Style:
- Genuine friends, not announcers reading alternating statements
- Varied sentence lengths, occasional short reactions and follow-ups
- Warmth, opinions, personal observations from Central Florida moms who visit often
- Natural transitions; limited subtle interruptions as brief overlapping reactions in text only
- No forced comedy, no constant agreement, no exaggerated/childish voices, no heavy accents
- No unsupported claims; no Disney affiliation or inside access
- Gena generally guides; Diane reacts, adds context, sometimes disagrees
- Mention the unofficial-fan disclosure once near the open
- End with a light sign-off pointing listeners to TheFloridaBuzz.com

Return ONLY the dialogue script.`,
    user: `Episode: ${episode.title}
Description: ${episode.description}
Disclosure to include once: ${DISCLOSURE}

Outline:
${outline}

Sources (summarize; link details belong in show notes, not as long quotes):
${sourceBlock || '(none)'}`,
  };
}

async function generateOutline({ aiText, show, episode, sources }) {
  const prompt = buildOutlinePrompt({ show, episode, sources });
  const text = await aiText.generateText({
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: 1200,
  });
  return String(text || '').trim();
}

async function generateConversation({ aiText, show, episode, outline, sources }) {
  const prompt = buildConversationPrompt({ show, episode, outline, sources });
  const text = await aiText.generateText({
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: 4000,
  });
  const script = String(text || '').trim();
  if (!/^Gena:/m.test(script) || !/^Diane:/m.test(script)) {
    throw new Error('Generated script must include Gena: and Diane: dialogue lines');
  }
  return script;
}

function splitScriptIntoSections(scriptText, maxChars) {
  const lines = String(scriptText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
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
  buildOutlinePrompt,
  buildConversationPrompt,
  generateOutline,
  generateConversation,
  splitScriptIntoSections,
  formatScriptForTts,
};
