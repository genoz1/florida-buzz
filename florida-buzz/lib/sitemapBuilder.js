'use strict';

const { isIndexableArticle } = require('./articlesQuery');
const { isRedirectedArticleSlug } = require('./articleRedirects');

const ARTICLE_SEGMENT_SIZE = 500;
const SITEMAP_CACHE_TTL_MS = 15 * 60 * 1000;

function lastmodForArticle(article) {
  const raw = article.content_updated_at || article.updated_at || article.published_at || article.created_at;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderUrlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : ''}
    <priority>${escapeXml(u.priority || '0.5')}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
}

function renderSitemapIndex(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <sitemap>
    <loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}
  </sitemap>`
  )
  .join('\n')}
</sitemapindex>`;
}

function staticSitemapUrls(siteUrl, { categoryOrder = [], cityOrder = [], pillars = {}, diningParks = {} } = {}) {
  return [
    { loc: siteUrl, priority: '1.0' },
    { loc: `${siteUrl}/guides`, priority: '0.9' },
    { loc: `${siteUrl}/wait-times`, priority: '0.9' },
    { loc: `${siteUrl}/planner`, priority: '0.9' },
    { loc: `${siteUrl}/dining`, priority: '0.8' },
    ...Object.keys(diningParks).map((park) => ({ loc: `${siteUrl}/dining/${park}`, priority: '0.8' })),
    ...categoryOrder.map((cat) => ({ loc: `${siteUrl}/category/${cat}`, priority: '0.8' })),
    ...cityOrder.map((city) => ({ loc: `${siteUrl}/city/${city}`, priority: '0.7' })),
    ...Object.keys(pillars).map((slug) => ({ loc: `${siteUrl}/guide/${slug}`, priority: '0.8' })),
    { loc: `${siteUrl}/about`, priority: '0.5' },
    { loc: `${siteUrl}/editorial-standards`, priority: '0.4' },
    { loc: `${siteUrl}/corrections-policy`, priority: '0.3' },
    { loc: `${siteUrl}/merch`, priority: '0.7' },
    { loc: `${siteUrl}/sponsors`, priority: '0.6' },
    { loc: `${siteUrl}/sponsors/become`, priority: '0.6' },
    { loc: `${siteUrl}/docs/Florida_Buzz_Sponsor_Packet.pdf`, priority: '0.5' },
    { loc: `${siteUrl}/gene-zentko`, priority: '0.5' },
    { loc: `${siteUrl}/privacy`, priority: '0.3' },
    { loc: `${siteUrl}/terms`, priority: '0.3' },
  ];
}

function articleSitemapUrls(siteUrl, articles) {
  return (articles || [])
    .filter((a) => isIndexableArticle(a) && !isRedirectedArticleSlug(a.slug))
    .map((a) => ({
      loc: `${siteUrl}/article/${a.slug}`,
      lastmod: lastmodForArticle(a),
      priority: '0.6',
    }));
}

function createSitemapBuilder({
  fetchArticles,
  fetchPodcastEntries = async () => [],
  siteUrl = 'https://thefloridabuzz.com',
  categoryOrder = [],
  cityOrder = [],
  pillars = {},
  diningParks = {},
  segmentSize = ARTICLE_SEGMENT_SIZE,
  now = () => Date.now(),
} = {}) {
  let cache = null;
  let building = null;

  async function buildFresh() {
    const articles = await fetchArticles();
    if (!Array.isArray(articles)) {
      throw new Error('Sitemap article fetch did not return an array');
    }
    const staticUrls = staticSitemapUrls(siteUrl, { categoryOrder, cityOrder, pillars, diningParks });
    const articleUrls = articleSitemapUrls(siteUrl, articles);
    let podcastUrls = [];
    try {
      podcastUrls = (await fetchPodcastEntries()) || [];
    } catch (err) {
      console.error('[sitemap] podcast entries skipped:', err.message);
    }

    const staticXml = renderUrlset([...staticUrls, ...podcastUrls]);
    const segments = [];
    for (let i = 0; i < articleUrls.length; i += segmentSize) {
      segments.push(articleUrls.slice(i, i + segmentSize));
    }
    if (!segments.length) segments.push([]);

    const articleXml = segments.map((seg) => renderUrlset(seg));
    const newestLastmod = articleUrls.map((u) => u.lastmod).filter(Boolean).sort().reverse()[0] || null;
    const indexEntries = [
      { loc: `${siteUrl}/sitemap-static.xml`, lastmod: newestLastmod },
      ...articleXml.map((_, idx) => ({
        loc: `${siteUrl}/sitemap-articles-${idx + 1}.xml`,
        lastmod: newestLastmod,
      })),
    ];
    const indexXml = renderSitemapIndex(indexEntries);
    const urlCount = staticUrls.length + articleUrls.length + podcastUrls.length;

    return {
      indexXml,
      staticXml,
      articleXml,
      urlCount,
      articleCount: articleUrls.length,
      builtAt: now(),
    };
  }

  async function getBundle({ allowStale = true } = {}) {
    if (cache?.indexXml && now() < cache.expires) {
      return { ok: true, bundle: cache, stale: false };
    }
    try {
      // Google fetches the index and its children together. Share one database
      // read across concurrent requests and honor the existing cache lifetime.
      if (!building) building = buildFresh().finally(() => { building = null; });
      const fresh = await building;
      cache = { ...fresh, expires: now() + SITEMAP_CACHE_TTL_MS };
      return { ok: true, bundle: cache, stale: false };
    } catch (err) {
      if (allowStale && cache?.indexXml) {
        return { ok: true, bundle: cache, stale: true, error: err };
      }
      return { ok: false, error: err, bundle: null, stale: false };
    }
  }

  function getCachedBundle() {
    return cache;
  }

  /** Test helper */
  function seedCache(bundle) {
    cache = { ...bundle, expires: now() + SITEMAP_CACHE_TTL_MS };
  }

  return {
    getBundle,
    getCachedBundle,
    seedCache,
    buildFresh,
    staticSitemapUrls: () => staticSitemapUrls(siteUrl, { categoryOrder, cityOrder, pillars, diningParks }),
  };
}

module.exports = {
  ARTICLE_SEGMENT_SIZE,
  SITEMAP_CACHE_TTL_MS,
  lastmodForArticle,
  renderUrlset,
  renderSitemapIndex,
  staticSitemapUrls,
  articleSitemapUrls,
  createSitemapBuilder,
};
