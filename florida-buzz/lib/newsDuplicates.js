'use strict';

function normalizeForSimilarity(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)
    .filter(Boolean)
    // Recognize the same action in the reviewed "removing"/"removes" pair.
    .map((word) => /^(?:removed|removes|removing)$/.test(word) ? 'remove' : word);
}

const TITLE_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'at', 'from', 'with',
  'after', 'along', 'has', 'have', 'new', 'its', 'into', 'over', 'under', 'near',
]);

function contentWords(text) {
  return normalizeForSimilarity(text).filter((w) => w.length > 3 && !TITLE_STOPWORDS.has(w));
}

function titleSimilarity(a, b) {
  const left = new Set(normalizeForSimilarity(a));
  const right = new Set(normalizeForSimilarity(b));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((w) => right.has(w)).length;
  return intersection / new Set([...left, ...right]).size;
}

function contentTitleOverlap(a, b) {
  const left = new Set(contentWords(a));
  const right = new Set(contentWords(b));
  if (left.size < 3 || right.size < 3) return 0;
  const intersection = [...left].filter((w) => right.has(w)).length;
  return intersection / Math.min(left.size, right.size);
}

function titlesLookLikeDuplicate(a, b) {
  return titleSimilarity(a, b) >= 0.5 || contentTitleOverlap(a, b) >= 0.6;
}

async function findRecentNewsDuplicate(client, title, category, { now = Date.now() } = {}) {
  const since = new Date(now - 3 * 86400000).toISOString();
  const { data, error } = await client.from('articles')
    .select('slug,title')
    .eq('category', category)
    .gte('published_at', since);
  if (error || !Array.isArray(data)) {
    const failure = new Error('Recent-news duplicate check unavailable; publication must wait.');
    failure.code = 'duplicate_check_unavailable';
    throw failure;
  }
  return data.find((article) => titlesLookLikeDuplicate(title, article.title)) || null;
}

module.exports = { titleSimilarity, contentTitleOverlap, titlesLookLikeDuplicate, findRecentNewsDuplicate };
