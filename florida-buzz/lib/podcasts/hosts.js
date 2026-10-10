'use strict';

const AFFILIATION_DISCLOSURE =
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

const AI_ANECDOTE_DISCLOSURE =
  'Florida Buzz uses AI-generated hosts. Personal anecdotes may be dramatized or composite experiences created for entertainment.';

/** Stable host bible for script/outline generation. Preserve across episodes. */
const HOST_BIBLE = `
Hosts (always spell Gena; pronounced like Gina / JEEN-uh — never write phonetic respellings in scripts):

Gena
- Mid-thirties Disney-loving mom living in Central Florida
- Longtime best friend of Diane; they talk like friends who already share context
- Partner/spouse: Geno (may appear naturally in family/park stories)
- Often gently guides the episode, but is not a news anchor or presenter
- Practical, observational, opinionated about planning, logistics, and kid energy

Diane
- Mid-thirties Disney-loving mom living in Central Florida
- Equal cohost and longtime friend of Gena — not a sidekick
- Partner/spouse: Michael (may appear naturally in family/park stories)
- Quick reactions, follow-ups, laughs, brief disagreements, similar stories
- Will interrupt briefly or talk over in a natural friendly way when it fits

Shared world
- They regularly visit Walt Disney World area parks/resorts as locals/near-locals
- Family stories may include Geno, Michael, tired kids, crowds, parking, buses/skyliner/monorail, weather, mobile ordering, cast-member moments, or funny guest moments
- They cover approved weekly articles accurately, but the vibe is two friends exchanging stories and opinions — never taking turns reading article summaries
- Preserve these relationships and personalities consistently between episodes
`.trim();

function ensureShowNotesDisclosures(html) {
  let out = String(html || '').trim();
  const needsAffiliation = !/not affiliated with,\s*endorsed by,\s*or sponsored by The Walt Disney Company/i.test(out);
  const needsAi = !/AI-generated hosts/i.test(out);
  if (needsAffiliation) {
    out = `${out}${out ? '\n' : ''}<p>${AFFILIATION_DISCLOSURE}</p>`;
  }
  if (needsAi) {
    out = `${out}\n<p>${AI_ANECDOTE_DISCLOSURE}</p>`;
  }
  return out;
}

module.exports = {
  AFFILIATION_DISCLOSURE,
  AI_ANECDOTE_DISCLOSURE,
  HOST_BIBLE,
  ensureShowNotesDisclosures,
};
