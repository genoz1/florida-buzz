'use strict';

/**
 * Verified Florida Buzz public pages/tools that podcasts may promote.
 * Only list routes that currently exist and work — never invent features.
 */
const VERIFIED_SITE_TOOLS = Object.freeze([
  {
    key: 'home',
    spoken: 'The Florida Buzz dot com',
    title: 'The Florida Buzz',
    path: '/',
    when: 'general planning and finding the day’s coverage',
  },
  {
    key: 'guides',
    spoken: 'the planning guides on The Florida Buzz',
    title: 'Planning guides',
    path: '/guides',
    when: 'tickets, hotels, hopping, money-saving strategies, and evergreen planning',
  },
  {
    key: 'disney_planning_hub',
    spoken: 'the Disney World planning guide hub',
    title: 'Disney World planning guides',
    path: '/guide/disney-world-planning',
    when: 'Disney-specific planning deep-dives already published on Florida Buzz',
  },
  {
    key: 'dining',
    spoken: 'the dining guide',
    title: 'Dining guide',
    path: '/dining',
    when: 'restaurants, park dining directories, and meal planning',
  },
  {
    key: 'wait_times',
    spoken: 'current wait times on The Florida Buzz',
    title: 'Wait times',
    path: '/wait-times',
    when: 'checking attraction waits before or during a park day',
  },
  {
    key: 'planner',
    spoken: 'the day planner',
    title: 'Day planner',
    path: '/planner',
    when: 'building or adjusting a park day itinerary with family',
  },
  {
    key: 'buzz_board',
    spoken: 'the Buzz Board',
    title: 'Buzz Board',
    path: '/buzz',
    when: 'community questions, opinions, and follow-up discussions',
  },
]);

function siteBase(site) {
  return String(site || 'https://thefloridabuzz.com').replace(/\/$/, '');
}

function episodeTrackingParams(episode = {}) {
  const slug = String(episode.slug || episode.week_key || 'episode')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'episode';
  return {
    utm_source: 'florida_buzz_podcast',
    utm_medium: 'podcast',
    utm_campaign: 'florida_buzz_disney',
    utm_content: slug,
  };
}

function withTracking(url, episode = {}) {
  const parsed = new URL(url, 'https://thefloridabuzz.com');
  const params = episodeTrackingParams(episode);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function trackedSiteUrl(path, site, episode = {}) {
  const base = siteBase(site);
  const absolute = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  return withTracking(absolute, episode);
}

function verifiedToolsBlock() {
  return VERIFIED_SITE_TOOLS.map(
    (t) => `- ${t.title} (${t.path}) — use when discussing ${t.when}; spoken as “${t.spoken}”`
  ).join('\n');
}

function buildResourcesMentionedHtml({ sources = [], site, episode = {} } = {}) {
  const items = [];
  const seen = new Set();

  function push(title, url) {
    const tracked = withTracking(url, episode);
    if (seen.has(tracked)) return;
    seen.add(tracked);
    items.push({ title, url: tracked });
  }

  for (const source of sources.filter((s) => s.included !== false)) {
    if (!source.url) continue;
    push(source.title, source.url);
  }

  // Always include core tools so listeners can act on recommendations.
  for (const tool of VERIFIED_SITE_TOOLS) {
    if (tool.key === 'home') continue;
    push(tool.title, `${siteBase(site)}${tool.path}`);
  }

  if (!items.length) return '<p>No Florida Buzz resources selected for this draft.</p>';
  return `<ul>${items
    .map((item) => `<li><a href="${escapeAttr(item.url)}">${escapeHtml(item.title)}</a></li>`)
    .join('')}</ul>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

module.exports = {
  VERIFIED_SITE_TOOLS,
  episodeTrackingParams,
  withTracking,
  trackedSiteUrl,
  verifiedToolsBlock,
  buildResourcesMentionedHtml,
  siteBase,
};
