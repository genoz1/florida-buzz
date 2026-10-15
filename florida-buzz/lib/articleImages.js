const path = require('node:path');

const ARTICLE_PLACEHOLDER_PATH = '/images/article-placeholder-v1.svg';

function normalizeText(value, max = 500) {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function normalizeEntities(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entity) => normalizeText(entity, 80)).filter(Boolean))].slice(0, 12);
}

function buildImageBrief(article = {}) {
  return {
    subject: normalizeText(article.image_subject || article.title, 180),
    location: normalizeText(article.image_location || article.location, 120),
    entities: normalizeEntities(article.image_entities),
    category: normalizeText(article.category, 40),
  };
}

function imageIdentity(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const clean = url.trim().split('#')[0].split('?')[0];
  if (clean === ARTICLE_PLACEHOLDER_PATH || clean.endsWith(ARTICLE_PLACEHOLDER_PATH)) return ARTICLE_PLACEHOLDER_PATH;
  return clean.replace(/-thumb(?=\.[a-z0-9]+$)/i, '');
}

function findDuplicateImage(candidateUrl, recentArticles = [], currentSlug = '') {
  const candidate = imageIdentity(candidateUrl);
  if (!candidate || candidate === ARTICLE_PLACEHOLDER_PATH) return null;
  return recentArticles.find((article) => article?.slug !== currentSlug && imageIdentity(article?.image_url) === candidate) || null;
}

function isLikelyGenericSourceImage(url) {
  if (typeof url !== 'string') return true;
  const pathname = (() => {
    try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); }
  })();
  return /(?:^|[\/_-])(default|placeholder|fallback|site[-_]?logo|logo|blank|no[-_]?image|spacer)(?:[\/_\-.]|$)/i.test(pathname);
}

/**
 * True when the article has a real hosted story image (not null/empty and not
 * the designed "Story image coming soon" fallback).
 */
function isUsableArticleImage(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  const identity = imageIdentity(url);
  if (!identity || identity === ARTICLE_PLACEHOLDER_PATH) return false;
  if (/picsum\.photos|via\.placeholder|placehold\.it|placeholder\.com/i.test(url)) return false;
  return true;
}

/**
 * When enabled (default), automate refuses to publish articles that still lack
 * a usable story image. Set REQUIRE_ARTICLE_IMAGE=false only for emergency
 * rollback — that restores the old publish-then-repair behavior.
 */
function requireArticleImageEnabled(env = process.env) {
  return String(env.REQUIRE_ARTICLE_IMAGE || 'true').toLowerCase() !== 'false';
}

function contentAddressedName(originalFilename, fingerprint) {
  const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
  return `article-${fingerprint.slice(0, 32)}${ext === '.png' ? '.jpg' : ext}`;
}

module.exports = {
  ARTICLE_PLACEHOLDER_PATH,
  buildImageBrief,
  contentAddressedName,
  findDuplicateImage,
  imageIdentity,
  isLikelyGenericSourceImage,
  isUsableArticleImage,
  normalizeEntities,
  requireArticleImageEnabled,
};
