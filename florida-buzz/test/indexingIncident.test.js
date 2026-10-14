'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const http = require('http');

const {
  UpstreamError,
  isUpstreamError,
  allowSampleArticles,
  isIndexableArticle,
  createArticlesQuery,
} = require('../lib/articlesQuery');
const { createSitemapBuilder, lastmodForArticle } = require('../lib/sitemapBuilder');
const { createCanonicalHostRedirect } = require('../lib/canonicalHost');
const {
  logRequestOutcome,
  recordSitemapUrlCount,
  getObservabilitySnapshot,
  resetObservabilityForTests,
} = require('../lib/requestObservability');

function mockClient({ rows = [], failTimes = 0, failMessage = 'jwt rejected' } = {}) {
  let failuresLeft = failTimes;
  return {
    from() {
      const state = { filters: {}, limit: null, range: null, head: false };
      const api = {
        select(_cols, opts = {}) {
          state.head = Boolean(opts.head);
          return api;
        },
        eq(k, v) {
          state.filters[k] = v;
          return api;
        },
        order() {
          return api;
        },
        limit(n) {
          state.limit = n;
          return api;
        },
        range(from, to) {
          state.range = [from, to];
          return api;
        },
        then(resolve, reject) {
          return Promise.resolve()
            .then(async () => {
              if (failuresLeft > 0) {
                failuresLeft -= 1;
                return { data: null, error: { message: failMessage }, count: null };
              }
              let data = rows.slice();
              if (state.filters.slug) data = data.filter((r) => r.slug === state.filters.slug);
              if (state.filters.category) data = data.filter((r) => r.category === state.filters.category);
              if (state.head) {
                return { data: null, error: null, count: data.length };
              }
              if (state.range) {
                data = data.slice(state.range[0], state.range[1] + 1);
              } else if (state.limit) {
                data = data.slice(0, state.limit);
              }
              return { data, error: null, count: null };
            })
            .then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function fetchPath(port, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathName, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function mountArticleApp(query) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../views'));
  app.get('/article/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
      const result = await query.queryArticles({ slug, limit: 1 });
      const article = result.articles[0];
      if (!article) {
        logRequestOutcome({ status: 404, routeType: 'article', slug });
        return res.status(404).render('404');
      }
      return res.status(200).render('article', {
        article,
        related: [],
        ticker: [],
        planningOffers: [],
        categoryLabels: { 'theme-parks': 'Theme Parks' },
        placeholderImg: () => '/images/article-placeholder-v1.svg',
        thumbUrl: (u) => u,
        resizeImg: (u) => u,
        timeAgo: () => '1h ago',
        robots: /insufficient/i.test(article.slug) ? 'noindex,follow' : undefined,
      });
    } catch (err) {
      if (isUpstreamError(err)) {
        logRequestOutcome({
          status: 503,
          routeType: 'article',
          slug,
          errorCategory: err.category,
          message: err.message,
        });
        res.set('Retry-After', '300');
        res.set('Cache-Control', 'no-store');
        return res.status(503).render('unavailable', { canonicalPath: req.path });
      }
      throw err;
    }
  });
  return app;
}

test('existing article + successful database query → 200', async () => {
  const rows = [
    {
      slug: 'magic-kingdom-tips',
      title: 'Magic Kingdom Tips',
      dek: 'Useful tips',
      body_html: '<p>Hello</p>',
      category: 'theme-parks',
      source_name: 'Florida Buzz',
      source_url: 'https://example.com',
      published_at: '2026-10-01T12:00:00.000Z',
    },
  ];
  const query = createArticlesQuery({
    client: mockClient({ rows }),
    env: { NODE_ENV: 'production', SITE_URL: 'https://thefloridabuzz.com' },
    sleepFn: async () => {},
  });
  const { server, port } = await listen(mountArticleApp(query));
  try {
    const res = await fetchPath(port, '/article/magic-kingdom-tips');
    assert.equal(res.status, 200);
    assert.match(res.body, /Magic Kingdom Tips/);
    assert.match(res.body, /NewsArticle/);
    assert.doesNotMatch(res.body, /sample-/);
  } finally {
    server.close();
  }
});

test('genuine nonexistent slug + successful empty query → 404', async () => {
  const query = createArticlesQuery({
    client: mockClient({ rows: [] }),
    env: { NODE_ENV: 'production', SITE_URL: 'https://thefloridabuzz.com' },
    sleepFn: async () => {},
  });
  const { server, port } = await listen(mountArticleApp(query));
  try {
    const res = await fetchPath(port, '/article/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.body, /couldn'?t find that page/i);
    assert.doesNotMatch(res.body, /NewsArticle/);
  } finally {
    server.close();
  }
});

test('Supabase error followed by successful retry → 200', async () => {
  const rows = [
    {
      slug: 'retry-me',
      title: 'Retry Works',
      dek: 'Recovered',
      body_html: '<p>ok</p>',
      category: 'theme-parks',
      source_name: 'Florida Buzz',
      source_url: 'https://example.com',
      published_at: '2026-10-01T12:00:00.000Z',
    },
  ];
  const query = createArticlesQuery({
    client: mockClient({ rows, failTimes: 1 }),
    env: { NODE_ENV: 'production', SITE_URL: 'https://thefloridabuzz.com' },
    sleepFn: async () => {},
    retryDelayMs: 1,
  });
  const { server, port } = await listen(mountArticleApp(query));
  try {
    const res = await fetchPath(port, '/article/retry-me');
    assert.equal(res.status, 200);
    assert.match(res.body, /Retry Works/);
  } finally {
    server.close();
  }
});

test('persistent Supabase error → 503 with Retry-After/no-store, never 404', async () => {
  const query = createArticlesQuery({
    client: mockClient({ rows: [], failTimes: 99 }),
    env: { NODE_ENV: 'production', SITE_URL: 'https://thefloridabuzz.com' },
    sleepFn: async () => {},
    retryDelayMs: 1,
  });
  const { server, port } = await listen(mountArticleApp(query));
  try {
    const res = await fetchPath(port, '/article/any-real-slug');
    assert.equal(res.status, 503);
    assert.equal(res.headers['retry-after'], '300');
    assert.match(String(res.headers['cache-control'] || ''), /no-store/i);
    assert.match(res.body, /temporarily unavailable/i);
    assert.doesNotMatch(res.body, /NewsArticle/);
    assert.doesNotMatch(res.body, /sample-/i);
    assert.doesNotMatch(res.body, /couldn'?t find that page/i);
  } finally {
    server.close();
  }
});

test('persistent error never produces demo content from queryArticles', async () => {
  const query = createArticlesQuery({
    client: mockClient({ failTimes: 99 }),
    env: { NODE_ENV: 'production', SITE_URL: 'https://thefloridabuzz.com' },
    sleepFn: async () => {},
    retryDelayMs: 1,
  });
  await assert.rejects(() => query.queryArticles({ limit: 10 }), (err) => {
    assert.ok(err instanceof UpstreamError);
    return true;
  });
});

test('hasAnyRealArticles distinguishes query error from legitimate zero count', async () => {
  const empty = createArticlesQuery({
    client: mockClient({ rows: [] }),
    env: { NODE_ENV: 'production' },
    sleepFn: async () => {},
  });
  const emptyResult = await empty.hasAnyRealArticles();
  assert.equal(emptyResult.ok, true);
  assert.equal(emptyResult.count, 0);
  assert.equal(emptyResult.hasArticles, false);

  const broken = createArticlesQuery({
    client: mockClient({ failTimes: 99 }),
    env: { NODE_ENV: 'production' },
    sleepFn: async () => {},
    retryDelayMs: 1,
  });
  const brokenResult = await broken.hasAnyRealArticles();
  assert.equal(brokenResult.ok, false);
  assert.ok(brokenResult.error instanceof UpstreamError);
});

test('production-like hosts never allow sample articles', () => {
  assert.equal(allowSampleArticles({ NODE_ENV: 'production' }), false);
  assert.equal(allowSampleArticles({ SITE_URL: 'https://thefloridabuzz.com' }), false);
  assert.equal(allowSampleArticles({ NODE_ENV: 'development', ALLOW_SAMPLE_ARTICLES: 'true' }), true);
});

test('sitemap paginates past 1,000 and keeps every fixture article', async () => {
  const fixtures = [];
  for (let i = 1; i <= 1250; i += 1) {
    fixtures.push({
      slug: `story-${String(i).padStart(4, '0')}`,
      title: `Story ${i}`,
      dek: `Dek ${i}`,
      category: 'theme-parks',
      published_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    });
  }
  // Include non-indexable rows that must be excluded.
  fixtures.push({
    slug: 'insufficient-source-material',
    title: 'Insufficient Source Material',
    dek: 'x',
    category: 'theme-parks',
    published_at: '2026-01-01T00:00:00.000Z',
  });
  fixtures.push({
    slug: 'sample-theme-parks-0',
    title: 'Sample',
    dek: 'x',
    category: 'theme-parks',
    published_at: '2026-01-01T00:00:00.000Z',
  });

  const query = createArticlesQuery({
    client: mockClient({ rows: fixtures }),
    env: { NODE_ENV: 'production' },
    sleepFn: async () => {},
  });
  const builder = createSitemapBuilder({
    siteUrl: 'https://thefloridabuzz.com',
    categoryOrder: ['theme-parks'],
    cityOrder: ['orlando'],
    pillars: { 'disney-world-planning': {} },
    diningParks: { 'magic-kingdom': 'Magic Kingdom' },
    segmentSize: 500,
    fetchArticles: () => query.fetchAllIndexableArticles({ batchSize: 500 }),
    fetchPodcastEntries: async () => [],
  });

  const result = await builder.getBundle();
  assert.equal(result.ok, true);
  assert.equal(result.bundle.articleCount, 1250);
  assert.ok(result.bundle.articleXml.length >= 3);
  assert.match(result.bundle.indexXml, /sitemapindex/);
  assert.match(result.bundle.staticXml, /\/guides</);
  assert.match(result.bundle.staticXml, /\/category\/theme-parks</);
  const joined = result.bundle.articleXml.join('\n');
  assert.match(joined, /story-0001/);
  assert.match(joined, /story-1250/);
  assert.doesNotMatch(joined, /insufficient-source-material/);
  assert.doesNotMatch(joined, /sample-theme-parks-0/);
  for (let i = 1; i <= 1250; i += 1) {
    const slug = `story-${String(i).padStart(4, '0')}`;
    assert.ok(joined.includes(`/article/${slug}`), `missing ${slug}`);
  }
});

test('sitemap generation failure → 503 semantics or last-known-good, never empty success', async () => {
  let calls = 0;
  const builder = createSitemapBuilder({
    siteUrl: 'https://thefloridabuzz.com',
    fetchArticles: async () => {
      calls += 1;
      if (calls === 1) {
        return [
          {
            slug: 'keep-me',
            title: 'Keep',
            dek: 'd',
            category: 'theme-parks',
            published_at: '2026-10-01T00:00:00.000Z',
          },
        ];
      }
      throw new UpstreamError('db down', { category: 'supabase_query' });
    },
  });

  const first = await builder.getBundle();
  assert.equal(first.ok, true);
  assert.match(first.bundle.articleXml[0], /keep-me/);

  const second = await builder.getBundle({ allowStale: true });
  assert.equal(second.ok, true);
  assert.equal(second.stale, true);
  assert.match(second.bundle.articleXml[0], /keep-me/);

  const freshFailBuilder = createSitemapBuilder({
    siteUrl: 'https://thefloridabuzz.com',
    fetchArticles: async () => {
      throw new UpstreamError('db down', { category: 'supabase_query' });
    },
  });
  const failed = await freshFailBuilder.getBundle({ allowStale: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.bundle, null);
});

test('lastmod uses article timestamps, not deploy-time now', () => {
  assert.equal(
    lastmodForArticle({ published_at: '2026-05-04T15:22:11.000Z' }),
    '2026-05-04'
  );
  assert.equal(
    lastmodForArticle({ updated_at: '2026-06-01T01:00:00.000Z', published_at: '2026-05-04T15:22:11.000Z' }),
    '2026-06-01'
  );
});

test('www host permanently redirects to apex preserving path and query in one hop', async () => {
  const app = express();
  app.use(createCanonicalHostRedirect());
  app.get('/article/hello', (req, res) => res.status(200).send('ok'));
  const { server, port } = await listen(app);
  try {
    const res = await fetchPath(port, '/article/hello?utm=1', { Host: 'www.thefloridabuzz.com' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, 'https://thefloridabuzz.com/article/hello?utm=1');
    const apex = await fetchPath(port, '/article/hello?utm=1', { Host: 'thefloridabuzz.com' });
    assert.equal(apex.status, 200);
    assert.equal(apex.body, 'ok');
  } finally {
    server.close();
  }
});

test('isIndexableArticle excludes placeholders and redirect losers', () => {
  assert.equal(isIndexableArticle({ slug: 'good-story', title: 'Good' }), true);
  assert.equal(isIndexableArticle({ slug: 'insufficient-source-material', title: 'x' }), false);
  assert.equal(isIndexableArticle({ slug: 'sample-theme-parks-0', title: 'x' }), false);
  assert.equal(
    isIndexableArticle({ slug: 'fwc-wildlife-safety-tips-after-major-storms', title: 'x' }),
    false
  );
});

test('observability records sitemap URL count changes without secrets', () => {
  resetObservabilityForTests();
  recordSitemapUrlCount(1000);
  recordSitemapUrlCount(1250);
  const snap = getObservabilitySnapshot();
  assert.equal(snap.sitemapUrlCount, 1250);
  assert.equal(snap.recentSitemapUrlCountDeltas.at(-1).from, 1000);
  const line = logRequestOutcome({
    status: 503,
    routeType: 'article',
    slug: 'secret-token-should-not-matter',
    errorCategory: 'supabase_query',
    message: 'Authorization Bearer abc.def.ghi failed',
  });
  assert.equal(line.status, 503);
  assert.ok(!JSON.stringify(line).includes('Bearer abc'));
});
