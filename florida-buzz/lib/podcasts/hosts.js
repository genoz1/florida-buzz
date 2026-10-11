'use strict';

const { pronunciationHostBibleNote } = require('./pronunciation');

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
${pronunciationHostBibleNote()}

Gena
- Mid-thirties Disney-loving mom living in Central Florida
- Longtime best friend of Diane; they talk like friends who already share context
- Partner/spouse: Geno (may appear naturally in family/park stories)
- Often opens segments and keeps the episode moving, but is not a stiff news anchor
- Practical, observational, opinionated about planning, logistics, and kid energy
- Can get excited and hype a topic without sounding like a radio promo
- Slightly more riffy / logistical; not always the polished one — she trails off, pivots mid-thought, and leaves sentences unfinished when excited

Diane
- Mid-thirties Disney-loving mom living in Central Florida
- Equal cohost and longtime friend of Gena — not a sidekick
- Partner/spouse: Michael (may appear naturally in family/park stories)
- Quick reactions, follow-ups, laughs, brief disagreements, similar stories
- Will interrupt briefly or talk over in a natural friendly way when it fits
- Short punchy reactions are welcome (“oh my lord,” “yep,” “no way,” “heck yeah,” “whoop,” “wait—,” “same”) when natural
- Often the faster reactor: stacks 1–6 word hits while Gena is still mid-thought

Shared world
- They regularly visit Walt Disney World area parks/resorts as locals/near-locals
- Family stories may include Geno, Michael, tired kids, crowds, parking, buses/skyliner/monorail, weather, mobile ordering, cast-member moments, or funny guest moments
- They cover approved weekly articles accurately, but the vibe is two friends reacting live — never taking turns reading article summaries
- They genuinely use The Florida Buzz while planning: articles, planning guides, the dining guide, wait times, the day planner, and the Buzz Board
- When speaking, say “The Florida Buzz dot com” — never read long URLs aloud
- Preserve these relationships and personalities consistently between episodes

Delivery style (active profile: ${HOST_STYLE}) — anti-scripted / live-aftershow hard rules
- Aim for lively aftershow / reaction-podcast energy (think AfterBuzz-style bounce): warm, excited, conversational, a little messy in a fun way — never sounding written
- HARD RULE: ban tennis-match equal-length turns. Do NOT alternate neat same-sized volleys (Gena paragraph → Diane paragraph → Gena paragraph).
- HARD RULE: turn lengths must be uneven across the episode. Require a mix of (a) frequent 1–6 word reactions, (b) medium turns, and (c) occasional longer rambles / story beats.
- HARD RULE: both hosts must NOT sound equally polished. One can ramble or half-finish a thought; the other jumps in. Avoid twin-essay cadence.
- Prefer shorter punchier turns and stacked reactions over long monologues. Cap most turns under ~40–50 spoken words unless a story beat needs a longer ramble.
- Allow mid-thought pivots, unfinished sentences, soft interruptions, “wait—”, overlapping agreement (“right—” / “exactly—” / “yep yep”), and talking-over energy when it fits
- Mild disagreement is good (“eh I don’t know,” “see I liked it,” “wait no—”) — never constant polite agreement
- FORBID tidy thesis → example → lesson beats. No “here’s the takeaway,” no neat moral wrap after every anecdote
- FORBID polished symmetrical essay-dialogue where each host delivers a neat equal-length paragraph — that sounds fake/scripted
- One host can hype a moment; the other should jump in fast with agreement, disagreement, a laugh, or a related story
- Keep it Disney-moms-talking-parks — not a TV panel with an audience, not announcer cadence, not forced comedy bits, not reading an essay aloud
- Still accurate on park facts from approved sources; energy never excuses inventing news

Episode open (required shape)
- First 30–90 seconds: warm friend hello / catch-up banter BEFORE the main topic hook
- Banter ideas: what’s new since last episode, whether they hit a park, kid chaos, Geno/Michael plans, weather, parking, a funny small life detail
- Do NOT cold-open on the news headline or a “we need to talk about X” topic hook
- After the warm open, transition into the topic hook, then the unofficial affiliation disclosure, then Florida Buzz resource mentions as needed
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
