'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {
  normalizeSearchQuery,
  tokenizeSearchQuery,
  escapeIlikeToken,
  buildPostgrestTokenOrFilter,
  searchArticlesInMemory,
  rankSearchResults,
} = require('../lib/siteSearch');
const { createArticlesQuery, sampleArticles } = require('../lib/articlesQuery');

test('normalizes and tokenizes search queries', () => {
  assert.equal(normalizeSearchQuery('  Epic   Universe  '), 'Epic Universe');
  assert.deepEqual(tokenizeSearchQuery('Epic Universe!!!'), ['epic', 'universe']);
  assert.deepEqual(tokenizeSearchQuery('a'), []);
  assert.deepEqual(tokenizeSearchQuery('disney disney'), ['disney']);
  assert.equal(escapeIlikeToken('100%_fun,(ok)'), '100funok');
});

test('builds a safe PostgREST or-filter for one token', () => {
  assert.equal(
    buildPostgrestTokenOrFilter('manatee'),
    'title.ilike.%manatee%,dek.ilike.%manatee%,slug.ilike.%manatee%,meta_title.ilike.%manatee%'
  );
  assert.equal(buildPostgrestTokenOrFilter('%'), null);
});

test('in-memory search requires every token and ranks title hits first', () => {
  const rows = [
    {
      slug: 'quiet-beaches',
      title: 'Quiet Florida Beaches',
      dek: 'Skip the crowds',
      published_at: '2026-01-01T00:00:00Z',
    },
    {
      slug: 'manatee-gathering',
      title: 'Rare Manatee Gathering',
      dek: 'Wildlife officials confirm a large pod this week',
      published_at: '2026-02-01T00:00:00Z',
    },
    {
      slug: 'crystal-river-guide',
      title: 'Crystal River Day Trip',
      dek: 'See manatees in winter',
      published_at: '2026-03-01T00:00:00Z',
    },
  ];
  const found = searchArticlesInMemory(rows, 'manatee crystal');
  assert.deepEqual(
    found.articles.map((a) => a.slug),
    ['crystal-river-guide']
  );

  const ranked = rankSearchResults(rows, ['florida']);
  assert.equal(ranked[0].slug, 'quiet-beaches');
});

test('articlesQuery searchArticles works with sample data and a mock client', async () => {
  const sampleQuery = createArticlesQuery({
    client: null,
    env: { NODE_ENV: 'development', ALLOW_SAMPLE_ARTICLES: 'true' },
  });
  const sampleHit = await sampleQuery.searchArticles({ q: 'manatee' });
  assert.ok(sampleHit.articles.some((a) => /manatee/i.test(a.title)));
  assert.equal((await sampleQuery.searchArticles({ q: '' })).articles.length, 0);

  const rows = sampleArticles().concat({
    slug: 'epic-universe-hours',
    title: 'Epic Universe Hours Change',
    dek: 'What to know before you go',
    meta_title: 'Epic Universe park hours',
    category: 'theme-parks',
    source_name: 'Universal Orlando Blog',
    published_at: '2026-11-01T12:00:00Z',
    image_url: null,
  });

  const client = {
    from() {
      const api = {
        select() { return api; },
        or() { return api; },
        order() { return api; },
        limit() {
          return Promise.resolve({
            data: rows.filter((r) => /epic/i.test(`${r.title} ${r.dek} ${r.slug} ${r.meta_title || ''}`)),
            error: null,
          });
        },
      };
      return api;
    },
  };

  const dbQuery = createArticlesQuery({ client, env: { NODE_ENV: 'production' } });
  const hit = await dbQuery.searchArticles({ q: 'Epic Universe' });
  assert.ok(hit.articles.some((a) => a.slug === 'epic-universe-hours'));
  assert.equal(hit.source, 'database');
});

test('search page template renders results, empty, and noindex states', () => {
  const template = fs.readFileSync(path.join(__dirname, '../views/search.ejs'), 'utf8');
  const render = (locals) =>
    ejs.render(template, {
      ...locals,
      include: (name, data = {}) => {
        if (name.endsWith('header')) {
          return `<title>${data.pageTitle || ''}</title><meta name="robots" content="${data.robots || ''}"><form class="nav-search" action="/search"></form>`;
        }
        return '';
      },
      categoryLabels: { 'theme-parks': 'Theme Parks' },
      thumbUrl: () => '',
      placeholderImg: () => '/placeholder.svg',
      timeAgo: () => '1d ago',
    }, { filename: path.join(__dirname, '../views/search.ejs') });

  const empty = render({ query: '', articles: [], ticker: [], pagination: null });
  assert.match(empty, /Find a Florida Buzz story/);
  assert.match(empty, /name="robots" content="max-image-preview:large"/);

  const miss = render({ query: 'zzzz', articles: [], ticker: [], pagination: { total: 0 } });
  assert.match(miss, /No stories matched/);
  assert.match(miss, /noindex,follow/);

  const hit = render({
    query: 'Epic Universe',
    articles: [{
      slug: 'epic-universe-hours',
      title: 'Epic Universe Hours Change',
      dek: 'What to know',
      category: 'theme-parks',
      published_at: '2026-11-01',
      image_url: null,
    }],
    ticker: [],
    pagination: { page: 1, totalPages: 1, total: 1, prevHref: null, nextHref: null },
  });
  assert.match(hit, /href="\/article\/epic-universe-hours"/);
  assert.match(hit, /1\s+result/);
});

test('header exposes search in the masthead and SearchAction schema', () => {
  const header = fs.readFileSync(path.join(__dirname, '../views/partials/header.ejs'), 'utf8');
  assert.match(header, /action="\/search"/);
  assert.match(header, /nav-search/);
  assert.match(header, /mobile-search/);
  assert.match(header, /SearchAction/);
  assert.match(header, /\/search\?q=\{search_term_string\}/);
});

test('main router mounts /search before category archives', () => {
  const main = fs.readFileSync(path.join(__dirname, '../routes/main.js'), 'utf8');
  const searchIdx = main.indexOf("router.get('/search'");
  const categoryIdx = main.indexOf("router.get('/category/:cat'");
  assert.ok(searchIdx > 0 && categoryIdx > searchIdx);
  assert.match(main, /articlesQuery\.searchArticles/);
});
