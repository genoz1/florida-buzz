'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Minimal allowlist sanitizer for admin-authored show notes.
// Keeps simple formatting + links; strips scripts/events/styles.
function sanitizeShowNotesHtml(input) {
  const raw = String(input || '');
  if (!raw.trim()) return '';
  let html = raw
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*\/?\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');

  html = html.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (match, tag, attrs = '') => {
    const name = tag.toLowerCase();
    const allowed = new Set(['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote']);
    if (!allowed.has(name)) return '';
    if (match.startsWith('</')) return `</${name}>`;
    if (name === 'br') return '<br>';
    if (name === 'a') {
      const hrefMatch = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = (hrefMatch && (hrefMatch[2] || hrefMatch[3] || hrefMatch[4])) || '';
      if (!/^https?:\/\//i.test(href)) return '<a>';
      return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">`;
    }
    return `<${name}>`;
  });
  return html;
}

function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { escapeHtml, sanitizeShowNotesHtml, plainTextFromHtml };
