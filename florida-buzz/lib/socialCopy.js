// Platform-specific caption shaping for article / guide social posts.
// Keeps feed units conversation-native; off-site URLs stay secondary.

const STORY_SUFFIX_RE = /\s*Full (?:story|guide|review)\s*(?:↓|⬇️)?\s*$/i;
const LINK_IN_BIO_RE = /\s*Full story\s*[—-]\s*link in bio\s*$/i;
const COMMENT_CTA_RE =
  /\b(what (?:do|would) you (?:think|do|pick|change)|tell us|drop your|comment|agree or|would you|thoughts\??)\b/i;

const INSTAGRAM_HASHTAGS_BY_CATEGORY = {
  'theme-parks': '#DisneyWorld #UniversalOrlando #FloridaTravel #FloridaBuzz',
  space: '#KennedySpaceCenter #SpaceCoast #FloridaTravel #FloridaBuzz',
  beaches: '#FloridaBeaches #VisitFlorida #FloridaTravel #FloridaBuzz',
  'florida-living': '#FloridaLife #VisitFlorida #FloridaTravel #FloridaBuzz',
  wildlife: '#FloridaWildlife #VisitFlorida #FloridaTravel #FloridaBuzz',
  cruises: '#FloridaCruises #PortCanaveral #CruiseLife #FloridaBuzz',
  food: '#FloridaEats #FloridaFood #FloridaTravel #FloridaBuzz',
  events: '#FloridaEvents #VisitFlorida #FloridaTravel #FloridaBuzz',
  'travel-deals': '#FloridaTravel #TravelDeals #VisitFlorida #FloridaBuzz',
};

function stripStorySuffix(text) {
  return String(text || '')
    .replace(LINK_IN_BIO_RE, '')
    .replace(STORY_SUFFIX_RE, '')
    .trim();
}

/**
 * Facebook captions should already include a real comment invite from the
 * writer (automate prompt). Do NOT append generic “Would this change your park
 * day?” / “What would you do?” stubs — those often mismatch the story
 * (e.g. Independence Day eagle → park-day CTA).
 */
function toFacebookFeedCaption(fbCaption) {
  return stripStorySuffix(fbCaption);
}

function instagramHashtagsForCategory(category) {
  return (
    INSTAGRAM_HASHTAGS_BY_CATEGORY[category] ||
    '#FloridaTravel #VisitFlorida #FloridaLife #FloridaBuzz'
  );
}

/**
 * Instagram: comment-first CTA, then bio/link path, then a short hashtag set.
 */
function toInstagramCaption(fbCaption, category = null) {
  const core = stripStorySuffix(fbCaption);
  if (!core) return core;
  const hashtags = instagramHashtagsForCategory(category);
  const withCta = COMMENT_CTA_RE.test(core)
    ? core
    : `${core}\n\nWhat would you do? Comment below 👇`;
  return `${withCta}\n\nFull story — link in bio\n\n${hashtags}`;
}

/**
 * Threads: lead with conversation; keep the URL secondary at the end.
 */
function toThreadsPost(fbCaption, articleUrl) {
  const core = stripStorySuffix(fbCaption);
  const prompt = core
    ? COMMENT_CTA_RE.test(core)
      ? core
      : `${core}\n\nAgree or push back?`
    : 'Worth a closer look — agree or push back?';
  return articleUrl ? `${prompt}\n\n${articleUrl}` : prompt;
}

/**
 * Light Pinterest SEO cleanup: keep AI copy, ensure Florida/search context
 * without keyword stuffing or changing image rules.
 */
function normalizePinCopy({ pin_title, pin_description, category = null, title = null } = {}) {
  let pinTitle = String(pin_title || '').trim();
  let pinDescription = String(pin_description || '').trim();

  if (!pinTitle && title) pinTitle = String(title).trim().slice(0, 100);

  if (pinTitle && !/florida|disney|universal|orlando|cruise|beach|miami|tampa|key west/i.test(pinTitle)) {
    const suffix =
      category === 'cruises'
        ? ' | Florida Cruise Tips'
        : category === 'beaches'
          ? ' | Florida Beaches'
          : category === 'theme-parks'
            ? ' | Florida Theme Parks'
            : ' | Florida Travel';
    const next = `${pinTitle}${suffix}`;
    if (next.length <= 100) pinTitle = next;
  }

  if (pinDescription && !/florida|plan|trip|visit|park|beach|cruise/i.test(pinDescription)) {
    pinDescription = `${pinDescription} Useful for planning a Florida trip.`.trim();
  }
  if (pinDescription.length > 500) pinDescription = pinDescription.slice(0, 497).trimEnd() + '...';
  if (pinTitle.length > 100) pinTitle = pinTitle.slice(0, 97).trimEnd() + '...';

  return { pin_title: pinTitle, pin_description: pinDescription };
}

module.exports = {
  COMMENT_CTA_RE,
  INSTAGRAM_HASHTAGS_BY_CATEGORY,
  instagramHashtagsForCategory,
  normalizePinCopy,
  stripStorySuffix,
  toFacebookFeedCaption,
  toInstagramCaption,
  toThreadsPost,
};
