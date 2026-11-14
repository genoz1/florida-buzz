'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectArticlesForSitemap,
  articleSitemapUrls,
  createSitemapBuilder,
  SITEMAP_NEWS_CAP,
} = require('../lib/sitemapBuilder');

test('sitemap selection keeps evergreen and recent news, drops old commodity news', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const rows = [
    { slug: 'guide-evergreen', title: 'Planning Guide', is_evergreen: true, published_at: '2025-01-01' },
    { slug: 'fresh-news', title: 'Disney Hours Change', published_at: '2026-11-10' },
    { slug: 'old-news', title: 'Old Park Story', published_at: '2026-06-01' },
    { slug: 'week-roundup', title: 'Things to Do This Week in Orlando', published_at: '2026-11-12' },
    { slug: 'echo-lake', title: 'Echo Lake', published_at: '2026-11-11' },
    { slug: 'echo-lake-2', title: 'Echo Lake Dup', published_at: '2026-11-11' },
  ];
  const selected = selectArticlesForSitemap(rows, { now });
  const slugs = selected.map((a) => a.slug).sort();
  assert.deepEqual(slugs, ['echo-lake', 'fresh-news', 'guide-evergreen']);
});

test('news cap bounds sitemap volume', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const rows = Array.from({ length: SITEMAP_NEWS_CAP + 80 }, (_, i) => ({
    slug: `news-${i}`,
    title: `Story ${i}`,
    published_at: '2026-11-01',
  }));
  const selected = selectArticlesForSitemap(rows, { now });
  assert.equal(selected.length, SITEMAP_NEWS_CAP);
});

test('sitemap index lists recent first and stays far below the old 4k flood', async () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const articles = [
    ...Array.from({ length: 40 }, (_, i) => ({
      slug: `guide-${i}`,
      title: `Guide ${i}`,
      is_evergreen: true,
      published_at: '2025-05-01',
    })),
    ...Array.from({ length: 900 }, (_, i) => ({
      slug: `news-${i}`,
      title: `News ${i}`,
      published_at: i < 200 ? '2026-11-01' : '2026-05-01',
    })),
  ];
  const builder = createSitemapBuilder({
    fetchArticles: async () => articles,
    siteUrl: 'https://thefloridabuzz.com',
    now: () => now,
  });
  const bundle = await builder.buildFresh();
  assert.match(bundle.indexXml, /sitemap-recent\.xml/);
  assert.ok(bundle.articleCount <= 40 + SITEMAP_NEWS_CAP);
  assert.ok(bundle.articleCount < 500);
  const urls = articleSitemapUrls('https://thefloridabuzz.com', articles, { now });
  assert.ok(urls.every((u) => !u.loc.includes('news-500')));
});
