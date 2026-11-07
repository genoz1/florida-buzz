'use strict';

const { isUsableArticleImage } = require('./articleImages');

/**
 * Sort theme-park (or any) news for homepage feature slots:
 * editorially featured first, then newest. Only stories with usable images.
 * @param {object[]} articles
 * @returns {object[]}
 */
function rankStoriesForFeature(articles) {
  return (articles || [])
    .filter((a) => a && a.slug && isUsableArticleImage(a.image_url))
    .slice()
    .sort((a, b) => {
      const feat = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
      if (feat !== 0) return feat;
      return Date.parse(b.published_at || 0) - Date.parse(a.published_at || 0);
    });
}

/**
 * Pick the lead + two side stories for the photo-led feature band.
 * @param {object[]} themeParkArticles
 * @returns {{ lead: object|null, side: object[], usedSlugs: Set<string> }}
 */
function pickFeaturedThemeParkStories(themeParkArticles) {
  const ranked = rankStoriesForFeature(themeParkArticles);
  const lead = ranked[0] || null;
  const side = ranked.slice(1, 3);
  const usedSlugs = new Set([lead, ...side].filter(Boolean).map((a) => a.slug));
  return { lead, side, usedSlugs };
}

/**
 * More theme-park cards below the feature band.
 * @param {object[]} themeParkArticles
 * @param {Set<string>} usedSlugs
 * @param {number} [limit=6]
 */
function pickMoreThemeParkStories(themeParkArticles, usedSlugs, limit = 6) {
  return rankStoriesForFeature(themeParkArticles)
    .filter((a) => !usedSlugs.has(a.slug))
    .slice(0, limit);
}

/**
 * Around-Florida rails: every non-theme-park category with image-backed stories.
 * @param {Record<string, object[]>} byCategory
 * @param {string[]} categoryOrder
 * @param {Set<string>} usedSlugs
 * @param {number} [perCategory=3]
 */
function pickAroundFlorida(byCategory, categoryOrder, usedSlugs, perCategory = 3) {
  const around = {};
  for (const cat of categoryOrder || []) {
    if (cat === 'theme-parks') continue;
    const rows = (byCategory[cat] || [])
      .filter((a) => a && !usedSlugs.has(a.slug) && isUsableArticleImage(a.image_url))
      .slice(0, perCategory);
    if (rows.length) around[cat] = rows;
  }
  return around;
}

module.exports = {
  rankStoriesForFeature,
  pickFeaturedThemeParkStories,
  pickMoreThemeParkStories,
  pickAroundFlorida,
};
