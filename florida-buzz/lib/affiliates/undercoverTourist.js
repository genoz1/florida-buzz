'use strict';

/**
 * Canonical Undercover Tourist affiliate links (CJ Affiliate evergreen deep-link).
 * Same base used by scripts/automate.js and scripts/generate-guide.js —
 * do not invent a different affiliate ID.
 */
const CJ_EVERGREEN_BASE = 'https://www.jdoqocy.com/click-101851476-15733832';
const DEFAULT_DESTINATION = 'https://www.undercovertourist.com/disney/';

const PARTNER_NAME = 'Undercover Tourist';

const AFFILIATE_DISCLOSURE_SHORT =
  'Undercover Tourist is a Florida Buzz partner. If you book through our link, we may earn a commission at no extra cost to you.';

/** Spoken mid-roll direction (~15–25 sec) for solo Geno scripts — not read as a hard ad. */
const PODCAST_MIDROLL_DIRECTION =
  "If you're planning a Disney trip, check our partner Undercover Tourist for tickets and hotel deals — the link is in the show notes. Booking there helps support the show. Keep it human and brief; disclose it's a partner/affiliate; no hard-sell spam. Do not read the URL aloud.";

/** Soft outro reminder direction. */
const PODCAST_OUTRO_DIRECTION =
  'Brief reminder: the Undercover Tourist partner link for tickets and hotels is in the show notes — then warm goodbye with Florida Buzz resources. No hard sell.';

function undercoverTouristBase(env = process.env) {
  return String(env.UNDERCOVER_TOURIST_LINK || CJ_EVERGREEN_BASE).replace(/\/$/, '');
}

/**
 * Tracked affiliate URL for homepage, show notes, and descriptions.
 * Prefer UNDERCOVER_TOURIST_URL when set (full ready-to-use URL, as in article.ejs);
 * otherwise build CJ evergreen deep-link with a Disney destination.
 */
function undercoverTouristUrl(env = process.env, { destination = DEFAULT_DESTINATION } = {}) {
  const ready = String(env.UNDERCOVER_TOURIST_URL || '').trim();
  if (ready) return ready;
  const base = undercoverTouristBase(env);
  return `${base}?url=${encodeURIComponent(destination)}`;
}

function partnerShowNotesHtml(env = process.env) {
  const url = undercoverTouristUrl(env);
  const safeUrl = escapeHtml(url);
  return [
    '<h2>Partner: Undercover Tourist</h2>',
    `<p><a href="${safeUrl}" rel="nofollow sponsored noopener" target="_blank">Book Disney tickets &amp; hotel deals at Undercover Tourist</a></p>`,
    `<p><em>${escapeHtml(AFFILIATE_DISCLOSURE_SHORT)}</em></p>`,
  ].join('\n');
}

function partnerDescriptionBlurb(env = process.env) {
  const url = undercoverTouristUrl(env);
  return `Partner: Undercover Tourist for Disney tickets & hotels — ${url}. ${AFFILIATE_DISCLOSURE_SHORT}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  CJ_EVERGREEN_BASE,
  DEFAULT_DESTINATION,
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  PODCAST_MIDROLL_DIRECTION,
  PODCAST_OUTRO_DIRECTION,
  undercoverTouristBase,
  undercoverTouristUrl,
  partnerShowNotesHtml,
  partnerDescriptionBlurb,
};
