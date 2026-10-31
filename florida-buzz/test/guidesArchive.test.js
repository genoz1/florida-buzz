'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { createGuidesArchiveHandler } = require('../lib/guidesArchive');
const template = fs.readFileSync(path.join(__dirname, '../views/guides.ejs'), 'utf8');
const guides = Array.from({ length: 123 }, (_, i) => ({
  slug: 'guide-' + String(i).padStart(3, '0'), title: 'Guide ' + i,
  published_at: '2026-10-01', category: 'beaches', dek: 'Planning details',
}));
async function visit({ page, query = {}, rows = guides, error, fullTemplate = false } = {}) {
  let result;
  const handler = createGuidesArchiveHandler({
    getArticles: async (filter) => { if (error) throw error; return filter.evergreenOnly ? rows.slice().reverse() : []; },
    render404: () => { result = { status: 404 }; },
    render503: () => { result = { status: 503 }; },
    isUpstreamError: (err) => err.name === 'UpstreamError',
    viewLocals: { categoryLabels: { beaches: 'Beaches' }, thumbUrl: () => '', placeholderImg: () => '/placeholder.svg' },
  });
  await handler({ params: page === undefined ? {} : { page }, query }, {
    redirect: (status, url) => { result = { status, url }; },
    render: (_view, locals) => {
      const body = fullTemplate
        ? ejs.render(template, locals, { filename: path.join(__dirname, '../views/guides.ejs') })
        : ejs.render(template, { ...locals, include: (name, data) =>
          name.endsWith('header') ? '<title>' + data.pageTitle + '</title><link rel="canonical" href="' + data.canonicalPath + '">' : '' });
      result = { status: 200, body, locals };
    },
  }, (err) => { throw err; });
  return result;
}
test('all 123 guides remain reachable through sequential HTML links', async () => {
  const slugs = [];
  for (let p = 1; p <= 3; p++) {
    const r = await visit({ page: p === 1 ? undefined : String(p) });
    assert.equal(r.status, 200);
    assert.equal(r.locals.guides.length, p === 3 ? 23 : 50);
    assert.match(r.body, new RegExp('href="' + (p === 1 ? '/guides' : '/guides/page/' + p) + '"'));
    if (p < 3) assert.ok(r.body.includes('href="/guides/page/' + (p + 1) + '" rel="next"'));
    else assert.ok(!r.body.includes('rel="next"'));
    slugs.push(...r.locals.guides.map(g => g.slug));
  }
  assert.equal(new Set(slugs).size, 123);
  assert.deepEqual(slugs, guides.map(g => g.slug));
});
test('page two has its own canonical and links back to the first page', async () => {
  const r = await visit({ page: '2' });
  assert.match(r.body, /rel="canonical" href="\/guides\/page\/2"/);
  assert.match(r.body, /href="\/guides" rel="prev"/);
});
test('alternate page-one and query URLs redirect to the canonical path', async () => {
  assert.deepEqual(await visit({ page: '1' }), { status: 301, url: '/guides' });
  assert.deepEqual(await visit({ query: { page: '2' } }), { status: 301, url: '/guides/page/2' });
});
test('invalid and out-of-range pages return 404, including an empty archive', async () => {
  for (const page of ['0', '-1', '1.5', 'abc', '04', '999999999999999999', '4']) {
    assert.equal((await visit({ page })).status, 404);
  }
  assert.equal((await visit({ page: '2', rows: [] })).status, 404);
  assert.equal((await visit({ rows: [] })).status, 200);
});
test('database failure stays unavailable instead of pretending there are no guides', async () => {
  const error = new Error('unavailable'); error.name = 'UpstreamError';
  assert.equal((await visit({ error })).status, 503);
});

test('full guide page renders the real header and footer with an indexable canonical', async () => {
  const r = await visit({ page: '2', fullTemplate: true });
  assert.equal(r.status, 200);
  assert.match(r.body, /rel="canonical" href="https:\/\/thefloridabuzz.com\/guides\/page\/2"/);
  assert.match(r.body, /aria-label="Guide pages"/);
  assert.match(r.body, /<footer>/);
  assert.doesNotMatch(r.body, /name="robots" content="[^"]*noindex/);
});

test('database batches retain every guide when many publication dates are identical', async () => {
  const { createArticlesQuery } = require('../lib/articlesQuery');
  const rows = Array.from({ length: 1100 }, (_, i) => ({
    slug: 'bulk-guide-' + String(i).padStart(4, '0'),
    title: 'Planning guide ' + i, published_at: '2026-07-01', is_evergreen: true,
  }));
  let request = 0;
  const client = { from() {
    const order = [];
    const api = {
      select() { return api; }, eq() { return api; },
      order(column) { order.push(column); return api; },
      range(from, to) {
        request += 1;
        // A database can return ties in a different order for each request.
        const shift = order.includes('slug') ? 0 : request % rows.length;
        const ordered = rows.slice(shift).concat(rows.slice(0, shift));
        return Promise.resolve({ data: ordered.slice(from, to + 1), error: null });
      },
    };
    return api;
  } };
  const query = createArticlesQuery({ client, env: { NODE_ENV: 'production' } });
  const result = await query.queryArticles({ evergreenOnly: true });
  assert.equal(new Set(result.articles.map(g => g.slug)).size, rows.length);
  assert.deepEqual(result.articles.map(g => g.slug), rows.map(g => g.slug));
});
