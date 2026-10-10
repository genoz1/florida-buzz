'use strict';

const AFFILIATION_DISCLOSURE =
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

/**
 * Active host delivery style.
 * - aftershow_energy: lively AfterBuzz-like reactions, short hype, fast bounce
 * - friends_chat: calmer two-moms-catching-up (previous default)
 * Switch this back to 'friends_chat' anytime if aftershow energy does not sound right.
 */
const HOST_STYLE = 'aftershow_energy';

/** Stable host bible for script/outline generation. Preserve across episodes. */
const HOST_BIBLE = `
Hosts (always spell Gena; pronounced like Gina / JEEN-uh — never write phonetic respellings in scripts):

Gena
- Mid-thirties Disney-loving mom living in Central Florida
- Longtime best friend of Diane; they talk like friends who already share context
- Partner/spouse: Geno (may appear naturally in family/park stories)
- Often opens segments and keeps the episode moving, but is not a stiff news anchor
- Practical, observational, opinionated about planning, logistics, and kid energy
- Can get excited and hype a topic without sounding like a radio promo

Diane
- Mid-thirties Disney-loving mom living in Central Florida
- Equal cohost and longtime friend of Gena — not a sidekick
- Partner/spouse: Michael (may appear naturally in family/park stories)
- Quick reactions, follow-ups, laughs, brief disagreements, similar stories
- Will interrupt briefly or talk over in a natural friendly way when it fits
- Short punchy reactions are welcome (“oh my lord,” “yep,” “no way,” “heck yeah”) when natural

Shared world
- They regularly visit Walt Disney World area parks/resorts as locals/near-locals
- Family stories may include Geno, Michael, tired kids, crowds, parking, buses/skyliner/monorail, weather, mobile ordering, cast-member moments, or funny guest moments
- They cover approved weekly articles accurately, but the vibe is two friends exchanging stories and opinions — never taking turns reading article summaries
- They genuinely use The Florida Buzz while planning: articles, planning guides, the dining guide, wait times, the day planner, and the Buzz Board
- When speaking, say “The Florida Buzz dot com” — never read long URLs aloud
- Preserve these relationships and personalities consistently between episodes

Delivery style (active profile: ${HOST_STYLE})
- Aim for lively aftershow / reaction-podcast energy: warm, excited, conversational bounce
- Prefer shorter turns and frequent reactions over long monologues
- One host can hype a moment; the other should jump in fast with agreement, disagreement, or a related story
- Brief overlaps, laughs, and unfinished sentences are good when they feel natural
- Keep it Disney-moms-talking-parks — not a TV panel with an audience, not announcer cadence, not forced comedy bits
- Still accurate on park facts from approved sources; energy never excuses inventing news
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
  ensureShowNotesDisclosures,
};
