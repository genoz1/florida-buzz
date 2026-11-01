'use strict';

const { ContentValidationError } = require('./contentValidation');

function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!url.hostname.includes('.') || /(^|\.)thefloridabuzz\.com$/i.test(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function appendGuideSources(guide, consultedSources) {
  const consulted = new Map();
  for (const source of consultedSources || []) {
    const url = sourceUrl(source.url);
    if (url) consulted.set(url, source);
  }
  if (!Array.isArray(guide.sources) || !guide.sources.length || guide.sources.length > 8) {
    throw new ContentValidationError('Guide must identify 1-8 supporting research sources.');
  }
  const selected = new Map();
  for (const source of guide.sources) {
    const url = sourceUrl(source.url);
    if (!url || !consulted.has(url)) {
      throw new ContentValidationError('Guide source was not returned by the live research tool.');
    }
    const title = consulted.get(url).title || source.title || new URL(url).hostname;
    selected.set(url, title);
  }

  let inlineSources = 0;
  for (const match of guide.body_html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi)) {
    const href = match[2].replace(/&amp;/gi, '&');
    // Affiliate placeholders are converted separately after validation.
    if (/^(?:\/(?!\/)|#|AFFILIATE_(?:SEARCH|UT):)/i.test(href)) continue;
    const url = sourceUrl(href);
    if (!url || !consulted.has(url)) {
      throw new ContentValidationError('Guide includes an external link not returned by live research.');
    }
    inlineSources += 1;
  }
  if (!inlineSources) {
    throw new ContentValidationError('Guide must link supporting sources beside its factual claims.');
  }

  const items = [...selected].map(([url, title]) =>
    `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a></li>`
  ).join('\n');
  return `${guide.body_html}\n<section class="guide-sources" aria-label="Guide sources"><h3>Sources used for this guide</h3><ul>${items}</ul></section>`;
}

module.exports = { sourceUrl, appendGuideSources };
