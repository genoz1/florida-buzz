'use strict';

/**
 * Permanent article slug redirects (301).
 * Use when merging near-duplicate news posts: keep the winner URL, send the
 * loser here so Search Console / bookmarks don't 404.
 */
const ARTICLE_SLUG_REDIRECTS = Object.freeze({
  // Near-identical FWC post-storm wildlife tips (KPTV vs WISTV rewrites).
  // Winner: florida-wildlife-safety-tips-after-a-major-storm
  'fwc-wildlife-safety-tips-after-major-storms':
    'florida-wildlife-safety-tips-after-a-major-storm',
  // Cross-feed Key West sargassum pilot (Yahoo vs The Cool Down rewrites).
  // Winner: key-west-sargassum-cleanup-pilot-plans
  'key-west-sargassum-cleanup-pilot-plan':
    'key-west-sargassum-cleanup-pilot-plans',
  // The same Live Wildly fifth-anniversary announcement syndicated by two feeds.
  // Keep the fuller July 1 article; both URLs were unindexed at review.
  'florida-s-wildlife-corridor-marks-five-years-of-progress-mr25dbtw':
    'florida-s-wildlife-corridor-marks-five-years-of-conservation-mr2fydey',
  // Same source article and substantially repeated coverage, reviewed October 31.
  'epcot-impulse-buys-to-skip-save-money-on-these-3-items':
    'epcot-impulse-buys-to-skip-and-what-to-bring-instead',
  'hall-of-presidents-magic-kingdom-changes-2026':
    'hall-of-presidents-magic-kingdom-updates-2026',
  'disney-typhoon-lagoon-closing-september-2026-indefinitely':
    'disney-typhoon-lagoon-closing-date-and-final-schedule-2026',
  'epcot-late-night-fireworks-testing-september-2026-warning':
    'epcot-late-night-fireworks-testing-september-2026',
  'walt-disney-world-transportation-changes-summer-2026-2':
    'walt-disney-world-transportation-changes-summer-2026',
  'universal-orlando-e-t-shoulder-buddy-new-collectible-2026':
    'universal-orlando-e-t-shoulder-buddy-2026-new-collectible',
  'disney-world-star-wars-halloween-droid-figure-2026':
    'r2-wrwlf-star-wars-halloween-droid-at-hollywood-studios-2026',
  'disney-world-floridian-way-road-change-august-10-2026-2':
    'disney-world-floridian-way-road-change-august-10-2026',
  'bill-baggs-cape-florida-state-park-updates-and-news':
    'bill-baggs-cape-florida-state-park-best-beach-award',
  'animal-kingdom-lodge-kidani-village-refurbishment-2026-2027':
    'animal-kingdom-lodge-kidani-village-refurbishment-2026',
  'utopia-of-the-seas-mechanical-delay-july-2025':
    'royal-caribbean-utopia-of-the-seas-delay-july-2025',
  'utopia-of-the-seas-port-canaveral-delay-july-2026':
    'royal-caribbean-utopia-of-the-seas-port-canaveral-delay-2026',
  'john-pennekamp-paddle-day-key-largo-september-2025':
    'john-pennekamp-paddle-day-key-largo-september-2026',
  'walt-disney-world-chefs-spotlight-national-culinary-arts-month-2':
    'walt-disney-world-chefs-spotlight-national-culinary-arts-month',
  'walt-disney-world-news-recap-july-2026-2':
    'walt-disney-world-news-recap-july-2026',
  'disney-cruise-line-best-large-ship-ocean-cruise-line-2026-2':
    'disney-cruise-line-best-large-ship-ocean-cruise-line-2026',
  'super-girl-surf-festival-jacksonville-beach-2026-lineup-2':
    'super-girl-surf-festival-jacksonville-beach-2026-lineup',
  'hollywoodland-supper-club-royal-caribbean-new-ship-review-2':
    'hollywoodland-supper-club-royal-caribbean-new-ship-review',
  'disney-cruise-line-st-maarten-expansion-2026':
    'disney-cruise-line-st-maarten-expansion-2026-2',
  'port-canaveral-summer-2026-cruise-ships-guide-2':
    'port-canaveral-summer-2026-cruise-ships-guide',
  'nasa-commercial-space-stations-phase-2-rfp-2025':
    'nasa-commercial-space-stations-phase-2-rfp-2025-2',
  '20-under-the-radar-florida-spots-worth-the-drive-mr3vequ8':
    'florida-s-best-kept-secrets-worth-the-drive-mr4534m6',
});

function resolveArticleRedirect(slug) {
  if (!slug) return null;
  return ARTICLE_SLUG_REDIRECTS[String(slug)] || null;
}

function isRedirectedArticleSlug(slug) {
  return Object.prototype.hasOwnProperty.call(ARTICLE_SLUG_REDIRECTS, String(slug || ''));
}

function filterRedirectedArticles(articles) {
  if (!Array.isArray(articles) || !articles.length) return articles || [];
  return articles.filter((a) => !isRedirectedArticleSlug(a?.slug));
}

module.exports = {
  ARTICLE_SLUG_REDIRECTS,
  resolveArticleRedirect,
  isRedirectedArticleSlug,
  filterRedirectedArticles,
};
