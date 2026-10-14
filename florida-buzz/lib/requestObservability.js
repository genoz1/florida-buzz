'use strict';

/**
 * Structured request logging for indexing health.
 * Never logs secrets, Authorization headers, or query service keys.
 */

function safeSlug(slug) {
  return String(slug || '')
    .slice(0, 120)
    .replace(/[^\w.-]+/g, '-');
}

function redactMessage(message) {
  if (!message) return null;
  return String(message)
    .replace(/Bearer\s+[A-Za-z0-9._\-+=/]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/(api[_-]?key|service[_-]?key|password|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 300);
}

function logRequestOutcome({
  status,
  routeType,
  slug = null,
  errorCategory = null,
  message = null,
} = {}) {
  const payload = {
    type: status >= 500 ? 'upstream_failure' : status === 404 ? 'not_found' : 'request_outcome',
    status,
    routeType,
    slug: slug ? safeSlug(slug) : null,
    errorCategory: errorCategory || null,
    message: redactMessage(message),
    at: new Date().toISOString(),
  };
  const line = JSON.stringify(payload);
  if (status >= 500) console.error(line);
  else if (status === 404) console.warn(line);
  else console.log(line);
  return payload;
}

/** In-memory counters for simple spike monitoring (process-local). */
const counters = {
  article404: 0,
  article503: 0,
  sitemapUrlCount: null,
  sitemapUrlCountDeltas: [],
};

function recordArticle404() {
  counters.article404 += 1;
}

function recordArticle503() {
  counters.article503 += 1;
}

function recordSitemapUrlCount(count) {
  if (typeof counters.sitemapUrlCount === 'number' && counters.sitemapUrlCount !== count) {
    counters.sitemapUrlCountDeltas.push({
      from: counters.sitemapUrlCount,
      to: count,
      at: new Date().toISOString(),
    });
    if (counters.sitemapUrlCountDeltas.length > 50) counters.sitemapUrlCountDeltas.shift();
  }
  counters.sitemapUrlCount = count;
}

function getObservabilitySnapshot() {
  return {
    article404: counters.article404,
    article503: counters.article503,
    sitemapUrlCount: counters.sitemapUrlCount,
    recentSitemapUrlCountDeltas: counters.sitemapUrlCountDeltas.slice(-10),
  };
}

function resetObservabilityForTests() {
  counters.article404 = 0;
  counters.article503 = 0;
  counters.sitemapUrlCount = null;
  counters.sitemapUrlCountDeltas = [];
}

module.exports = {
  logRequestOutcome,
  recordArticle404,
  recordArticle503,
  recordSitemapUrlCount,
  getObservabilitySnapshot,
  resetObservabilityForTests,
};
