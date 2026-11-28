'use strict';

// Older articles contain a generated ticket advertisement inside body_html.
// Remove only that known component; keep editorial links and product reviews.
function stripLegacyTicketCallouts(html) {
  const input = String(html || '');
  const opening = /<div\b[^>]*\bclass\s*=\s*(["'])shop-box\1[^>]*>/gi;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = opening.exec(input))) {
    const tags = /<div\b[^>]*>|<\/div\s*>/gi;
    tags.lastIndex = opening.lastIndex;
    let depth = 1;
    let tag;
    while (depth && (tag = tags.exec(input))) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
    }
    if (depth) break; // Preserve malformed markup rather than guessing an end.
    const end = tags.lastIndex;
    const block = input.slice(match.index, end);
    const isTicketCallout = /class\s*=\s*["']shop-box-text["']/i.test(block)
      && /class\s*=\s*["']shop-box-cta["']/i.test(block)
      && /Planning Your Trip/i.test(block)
      && /Undercover Tourist/i.test(block)
      && /href\s*=\s*["']https:\/\/(?:www\.)?(?:jdoqocy\.com|undercovertourist\.com)\//i.test(block);
    if (isTicketCallout) {
      result += input.slice(cursor, match.index);
      cursor = end;
    }
    opening.lastIndex = end;
  }
  return result + input.slice(cursor);
}

function prepareArticleForDisplay(article) {
  return { ...article, body_html: stripLegacyTicketCallouts(article.body_html) };
}

function selectArticlePlanningOffers(article, offers) {
  const available = Array.isArray(offers) ? offers : [];
  if (article.is_evergreen || article.is_review) return available.slice(0, 2);
  const preferred = article.category === 'theme-parks'
    ? available.find((offer) => offer.id === 'undercover-tourist')
    : available[0];
  return preferred ? [preferred] : available.slice(0, 1);
}

// Individually reviewed coverage; retain the merged report's source credit.
const ADDITIONAL_SOURCES = Object.freeze({
  'disney-world-fab-50-statues-being-removed': Object.freeze([
    Object.freeze({
      name: 'WDW Magic',
      url: 'https://www.wdwmagic.com/events/the-worlds-most-magical-celebration/news/26nov2026-disney-world-fab-50-character-statues-being-removed-from-magic-kingdom.htm',
    }),
  ]),
});

function additionalSourcesForArticle(slug) {
  return ADDITIONAL_SOURCES[slug] || [];
}

module.exports = {
  stripLegacyTicketCallouts,
  prepareArticleForDisplay,
  selectArticlePlanningOffers,
  additionalSourcesForArticle,
};
