'use strict';

/**
 * Numbered slug collisions (/article/foo-2, foo-3, …) dilute crawl budget and
 * trigger "Crawled – currently not indexed". Prefer the bare slug when it
 * exists; otherwise the lowest surviving suffix.
 */

function numberedSuffix(slug) {
  const m = String(slug || '').match(/^(.*)-(\d{1,3})$/);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isInteger(n) || n < 2) return null;
  // Avoid treating year suffixes like 2026 as collision markers when they are
  // the only numeric tail on a distinct slug — only collapse short -2/-3 style
  // serials (1–99). Years 1000+ stay untouched.
  if (n >= 100) return null;
  return { base: m[1], n };
}

function preferredCanonicalFromSet(slug, slugSet) {
  const suf = numberedSuffix(slug);
  if (!suf || !slugSet || typeof slugSet.has !== 'function') return null;
  // Only consolidate onto the bare slug. Do not collapse unrelated serials
  // onto each other when no bare winner exists (avoids false positives).
  if (slugSet.has(suf.base)) return suf.base;
  return null;
}

function filterNumberedDuplicateLosers(articles) {
  if (!Array.isArray(articles) || !articles.length) return articles || [];
  const slugSet = new Set(articles.map((a) => a && a.slug).filter(Boolean));
  return articles.filter((a) => {
    if (!a || !a.slug) return false;
    const preferred = preferredCanonicalFromSet(a.slug, slugSet);
    return !preferred || preferred === a.slug;
  });
}

module.exports = {
  numberedSuffix,
  preferredCanonicalFromSet,
  filterNumberedDuplicateLosers,
};
