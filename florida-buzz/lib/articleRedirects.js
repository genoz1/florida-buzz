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
