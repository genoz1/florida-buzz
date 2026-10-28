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

/** True when the URL is a Florida Buzz Supabase article-images object. */
function isHostedArticleImage(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  return /\/storage\/v1\/object\/public\/article-images\//i.test(url);
}

/**
 * Classify whether a hosted article hero was AI-generated or rehosted from a
 * source photo. New uploads use ai-article-* / src-article-* prefixes; legacy
 * content-addressed article-{hash} files are treated as generated (use as-is
 * for YouTube stills to avoid a second paid restyle).
 */
function articleImageOrigin(url) {
  if (!isUsableArticleImage(url)) return null;
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = String(url).split('?')[0];
  }
  const file = pathname.split('/').pop() || '';
  if (/^(ai-article-|generated-article-)/i.test(file)) return 'generated';
  if (/^(src-article-|sourced-article-)/i.test(file)) return 'sourced';
  // Legacy content-addressed AI (and older mixed) uploads.
  if (/^article-[a-f0-9]{20,}\./i.test(file)) return 'generated';
  // Slug-style filenames in our bucket are typically rehosted source photos.
  if (isHostedArticleImage(url)) return 'sourced';
  return 'generated';
}

/**
 * When enabled (default), automate refuses to publish articles that still lack
 * a usable story image. Set REQUIRE_ARTICLE_IMAGE=false only for emergency
 * rollback — that restores the old publish-then-repair behavior.
 */
function requireArticleImageEnabled(env = process.env) {
  return String(env.REQUIRE_ARTICLE_IMAGE || 'true').toLowerCase() !== 'false';
}

function contentAddressedName(originalFilename, fingerprint, { origin = null } = {}) {
  const ext = path.extname(originalFilename).toLowerCase() || '.jpg';
  const safeExt = ext === '.png' ? '.jpg' : ext;
  const hash = String(fingerprint || '').slice(0, 32);
  if (origin === 'sourced') return `src-article-${hash}${safeExt}`;
  if (origin === 'generated') return `ai-article-${hash}${safeExt}`;
  return `article-${hash}${safeExt}`;
}

module.exports = {
  ARTICLE_PLACEHOLDER_PATH,
  articleImageOrigin,
  buildImageBrief,
  contentAddressedName,
  findDuplicateImage,
  imageIdentity,
  isHostedArticleImage,
  isLikelyGenericSourceImage,
  isUsableArticleImage,
  normalizeEntities,
  requireArticleImageEnabled,
};
