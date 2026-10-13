'use strict';

/**
 * Canonical Undercover Tourist affiliate links (CJ Affiliate evergreen deep-link).
 * Same base used by scripts/automate.js and scripts/generate-guide.js —
 * do not invent a different affiliate ID.
 */
const CJ_EVERGREEN_BASE = 'https://www.jdoqocy.com/click-101851476-15733832';
const DEFAULT_DESTINATION = 'https://www.undercovertourist.com/disney/';

const DESTINATIONS = {
  disney: 'https://www.undercovertourist.com/disney/',
  'disney-world': 'https://www.undercovertourist.com/orlando/walt-disney-world-resort/',
  universal: 'https://www.undercovertourist.com/universal/',
  'universal-orlando': 'https://www.undercovertourist.com/orlando/universal-orlando-resort/',
  'epic-universe': 'https://www.undercovertourist.com/epic-universe/',
  seaworld: 'https://www.undercovertourist.com/orlando/seaworld-orlando-resort/',
  legoland: 'https://www.undercovertourist.com/orlando/legoland-florida-resort/',
  'theme-parks': 'https://www.undercovertourist.com/theme-parks/',
  orlando: 'https://www.undercovertourist.com/orlando/',
};

const HOTEL_DESTINATIONS = {
  'disney-world': 'https://www.undercovertourist.com/disney-vacation-packages',
  'universal-orlando': 'https://www.undercovertourist.com/universal-vacation-packages/',
  'epic-universe': 'https://www.undercovertourist.com/universal-vacation-packages/',
};

const CAR_RENTAL_URL = 'https://www.undercovertourist.com/car-rental/';

const PARTNER_NAME = 'Undercover Tourist';

const AFFILIATE_DISCLOSURE_SHORT =
  'Undercover Tourist is a Florida Buzz partner. If you book through our link, we may earn a commission at no extra cost to you.';

/** Spoken mid-roll direction (~15–25 sec) for solo Geno scripts — not read as a hard ad. */
const PODCAST_MIDROLL_DIRECTION =
  "Quick human aside: our partner Undercover Tourist has Disney tickets and hotels — link in the show notes. Booking there helps support the show. Disclose it's a partner/affiliate; keep it brief; no vacation-planning pitch; no hard-sell spam. Do not read the URL aloud.";

/** Soft outro reminder direction. */
const PODCAST_OUTRO_DIRECTION =
  'Brief reminder: the Undercover Tourist partner link for tickets and hotels is in the show notes — then warm goodbye. Mention The Florida Buzz dot com lightly if natural. No hard sell, no planner lecture.';

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

function undercoverTouristDestinationUrl(key = 'disney', { variant = 'tickets' } = {}) {
  const cleanKey = String(key || 'disney').trim().toLowerCase();
  if (variant === 'car-rentals') return CAR_RENTAL_URL;
  if (variant === 'hotel' && HOTEL_DESTINATIONS[cleanKey]) return HOTEL_DESTINATIONS[cleanKey];
  return DESTINATIONS[cleanKey] || DESTINATIONS['theme-parks'] || DEFAULT_DESTINATION;
}

/**
 * Build a tracked UCT URL for a destination key / variant.
 * Unlike undercoverTouristUrl(), this ignores UNDERCOVER_TOURIST_URL so deep-links
 * can still target hotels/cars/parks when a single evergreen override is set for CTAs.
 */
function undercoverTouristTrackedUrl(
  env = process.env,
  { key = 'disney', variant = 'tickets', preferReadyUrl = false } = {}
) {
  if (preferReadyUrl) {
    const ready = String(env.UNDERCOVER_TOURIST_URL || '').trim();
    if (ready) return ready;
  }
  const destination = undercoverTouristDestinationUrl(key, { variant });
  const base = undercoverTouristBase(env);
  return `${base}?url=${encodeURIComponent(destination)}`;
}

/**
 * Short on-site path used in podcast plain-text descriptions.
 * Podcast apps often mangle long CJ query URLs; /go/undercover 302s to the tracked link.
 */
function undercoverTouristSitePath(siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com') {
  const base = String(siteUrl || 'https://thefloridabuzz.com').replace(/\/$/, '');
  return `${base}/go/undercover`;
}

function partnerShowNotesHtml(env = process.env) {
  // HTML show notes can use the short branded link (cleaner) — click still tracks via redirect.
  const url = undercoverTouristSitePath(env.SITE_URL || 'https://thefloridabuzz.com');
  const safeUrl = escapeHtml(url);
  return [
    '<h2>Partner: Undercover Tourist</h2>',
    `<p><a href="${safeUrl}" rel="nofollow sponsored noopener" target="_blank">Book Disney tickets &amp; hotel deals at Undercover Tourist</a></p>`,
    `<p><em>${escapeHtml(AFFILIATE_DISCLOSURE_SHORT)}</em></p>`,
  ].join('\n');
}

function partnerDescriptionBlurb(env = process.env) {
  const url = undercoverTouristSitePath(env.SITE_URL || 'https://thefloridabuzz.com');
  // Keep a space after the URL so podcast apps don't glue on the next period/word.
  return `Partner: Undercover Tourist for Disney tickets & hotels — ${url} — ${AFFILIATE_DISCLOSURE_SHORT}`;
}

/** Strip trailing punctuation podcast apps often glue onto URLs. */
function trimUrlMatch(match) {
  return String(match || '').replace(/[),.:;]+$/g, '');
}

/** Rewrite stored description/show-notes that still contain a raw CJ UCT URL. */
function rewritePartnerDescriptionLink(description, env = process.env) {
  const text = String(description || '');
  if (!text) return text;
  const shortUrl = undercoverTouristSitePath(env.SITE_URL || 'https://thefloridabuzz.com');
  let out = text.replace(/https?:\/\/(?:www\.)?jdoqocy\.com\/click-[^\s<>"']+/gi, (m) => {
    const cleaned = trimUrlMatch(m);
    // Only rewrite UCT evergreen / destination clicks — keep Hotels.com CJ links alone.
    if (!/15733832|undercovertourist/i.test(cleaned)) return m;
    return shortUrl;
  });
  out = out.replace(/https?:\/\/(?:www\.)?undercovertourist\.com\/disney\/?/gi, shortUrl);
  const escaped = shortUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(`(?:${escaped}\\s*){2,}`, 'g'), `${shortUrl} `);
  return out.slice(0, 4000);
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
  DESTINATIONS,
  HOTEL_DESTINATIONS,
  CAR_RENTAL_URL,
  PARTNER_NAME,
  AFFILIATE_DISCLOSURE_SHORT,
  PODCAST_MIDROLL_DIRECTION,
  PODCAST_OUTRO_DIRECTION,
  undercoverTouristBase,
  undercoverTouristUrl,
  undercoverTouristDestinationUrl,
  undercoverTouristTrackedUrl,
  undercoverTouristSitePath,
  partnerShowNotesHtml,
  partnerDescriptionBlurb,
  rewritePartnerDescriptionLink,
  escapeHtml,
};
