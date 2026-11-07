'use strict';

/**
 * Derive a short place label from a theme-park story title/dek when the place
 * is explicitly named. Falls back to Theme Parks — never invents venues.
 * @param {object} article
 * @returns {string}
 */
function homePlaceTag(article) {
  const hay = `${article?.title || ''} ${article?.dek || ''}`.toLowerCase();
  const rules = [
    [/disney springs/, 'Disney Springs'],
    [/epic universe/, 'Epic Universe'],
    [/animal kingdom lodge/, 'Animal Kingdom Lodge'],
    [/animal kingdom/, 'Animal Kingdom'],
    [/hollywood hollywood studios|hollywood hollywood/, 'Hollywood Studios'],
    [/\bepcot\b/, 'EPCOT'],
    [/magic kingdom/, 'Magic Kingdom'],
    [/universal orlando|islands of adventure|universal studios orlando/, 'Universal Orlando'],
    [/disney world|walt disney world/, 'Disney World'],
    [/\bdisney\b/, 'Disney'],
    [/\buniversal\b/, 'Universal'],
  ];

  for (const [re, label] of rules) {
    if (re.test(hay)) return label;
  }
  return 'Theme Parks';
}

module.exports = { homePlaceTag };
