const crypto = require('crypto');

class CommunityError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const CATEGORIES = new Set(['disney', 'universal', 'cruises', 'florida-life']);
const REPORT_REASONS = new Set([
  'spam', 'harassment', 'threatening', 'personal-information', 'scam', 'other',
]);

function normalizePlainText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
}

function hasUrl(value) {
  return /(?:https?:\/\/|www\.|\b[a-z0-9][a-z0-9-]{1,62}\.(?:com|net|org|io|co|me|us|info|biz)\b)/i.test(value);
}

function hasEmail(value) {
  return /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i.test(value);
}

function hasPhone(value) {
  return /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/.test(value);
}

function validateCommunityBody(value) {
  const body = normalizePlainText(value);
  if (body.length < 10 || body.length > 1500) throw new CommunityError('invalid_content');
  if (/[<>]/.test(body)) throw new CommunityError('html_not_allowed');
  if (hasEmail(body) || hasPhone(body)) throw new CommunityError('contact_information_not_allowed');
  if (hasUrl(body)) throw new CommunityError('links_not_allowed');
  return body;
}

function normalizedBodyHash(body) {
  const comparable = normalizePlainText(body).toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(comparable).digest('hex');
}

function validateCategory(value) {
  const category = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!CATEGORIES.has(category)) throw new CommunityError('invalid_category');
  return category;
}

function validateReportReason(value) {
  const reason = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!REPORT_REASONS.has(reason)) throw new CommunityError('invalid_report_reason');
  return reason;
}

function validateUuid(value, code = 'invalid_target') {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new CommunityError(code);
  }
  return id;
}

function validateSlug(value) {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (slug.length < 3 || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new CommunityError('invalid_slug');
  }
  return slug;
}

function validateStarter(input = {}) {
  const question = normalizePlainText(input.question);
  const context = normalizePlainText(input.context);
  const topic = normalizePlainText(input.topic);
  if (question.length < 10 || question.length > 220) throw new CommunityError('invalid_question');
  if (context.length > 1000 || /[<>]/.test(context)) throw new CommunityError('invalid_context');
  if (topic.length < 2 || topic.length > 80) throw new CommunityError('invalid_topic');
  return {
    slug: validateSlug(input.slug),
    question,
    context: context || null,
    topic,
    category: validateCategory(input.category),
  };
}

module.exports = {
  CATEGORIES,
  CommunityError,
  REPORT_REASONS,
  hasEmail,
  hasPhone,
  hasUrl,
  normalizePlainText,
  normalizedBodyHash,
  validateCategory,
  validateCommunityBody,
  validateReportReason,
  validateSlug,
  validateStarter,
  validateUuid,
};
