'use strict';

const MAX_QUERY_LENGTH = 80;
const MAX_TOKENS = 6;
const MIN_TOKEN_LENGTH = 2;

/**
 * Normalize a raw ?q= value for display and querying.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeSearchQuery(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * Split a query into searchable tokens (letters/digits only).
 * @param {unknown} raw
 * @returns {string[]}
 */
function tokenizeSearchQuery(raw) {
  const normalized = normalizeSearchQuery(raw).toLowerCase();
  if (!normalized) return [];
  const tokens = normalized
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH)
    .slice(0, MAX_TOKENS);
  // Preserve order, drop duplicates ("disney disney" → one token).
  const seen = new Set();
  const unique = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
  }
  return unique;
}

/**
 * Strip characters that break PostgREST filters or act as LIKE wildcards.
 * @param {string} token
 * @returns {string}
 */
function escapeIlikeToken(token) {
  return String(token || '').replace(/[%_\\,().]/g, '');
}

/**
 * Build a PostgREST `.or()` filter for one token against title/dek/slug/meta.
 * @param {string} token
 * @returns {string|null}
 */
function buildPostgrestTokenOrFilter(token) {
  const t = escapeIlikeToken(token);
  if (!t) return null;
  return `title.ilike.%${t}%,dek.ilike.%${t}%,slug.ilike.%${t}%,meta_title.ilike.%${t}%`;
}

function fieldHaystack(article) {
  return {
    title: String(article?.title || '').toLowerCase(),
    dek: String(article?.dek || '').toLowerCase(),
    slug: String(article?.slug || '').toLowerCase(),
    meta: String(article?.meta_title || '').toLowerCase(),
  };
}

/**
 * Rank matches so title hits beat dek/slug/meta, then newer stories win ties.
 * @param {object[]} articles
 * @param {string[]} tokens
 * @returns {object[]}
 */
function rankSearchResults(articles, tokens) {
  const toks = (tokens || []).map((t) => t.toLowerCase()).filter(Boolean);
  if (!toks.length) return Array.isArray(articles) ? articles.slice() : [];

  const scored = (articles || []).map((article) => {
    const fields = fieldHaystack(article);
    let score = 0;
    for (const token of toks) {
      if (fields.title.includes(token)) score += 8;
      if (fields.dek.includes(token)) score += 4;
      if (fields.slug.includes(token)) score += 3;
      if (fields.meta.includes(token)) score += 2;
    }
    const published = Date.parse(article.published_at || '') || 0;
    return { article, score, published };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.published - a.published;
  });

  return scored.filter((row) => row.score > 0).map((row) => row.article);
}

/**
 * In-memory search used for sample/demo data and unit tests.
 * @param {object[]} articles
 * @param {unknown} rawQuery
 * @returns {{ query: string, tokens: string[], articles: object[] }}
 */
function searchArticlesInMemory(articles, rawQuery) {
  const query = normalizeSearchQuery(rawQuery);
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) {
    return { query, tokens, articles: [] };
  }
  const matched = (articles || []).filter((article) => {
    const fields = fieldHaystack(article);
    return tokens.every(
      (token) =>
        fields.title.includes(token) ||
        fields.dek.includes(token) ||
        fields.slug.includes(token) ||
        fields.meta.includes(token)
    );
  });
  return { query, tokens, articles: rankSearchResults(matched, tokens) };
}

module.exports = {
  MAX_QUERY_LENGTH,
  MAX_TOKENS,
  MIN_TOKEN_LENGTH,
  normalizeSearchQuery,
  tokenizeSearchQuery,
  escapeIlikeToken,
  buildPostgrestTokenOrFilter,
  rankSearchResults,
  searchArticlesInMemory,
};
