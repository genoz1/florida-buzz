const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('rss-parser');

test('RSS is parseable and preserves stored image URLs without paid transformations', async () => {
  const queries = require('../lib/articlesQuery');
  const original = queries.createArticlesQuery;
  const images = [
    'https://example.supabase.co/storage/v1/object/public/article-images/test.jpg?download=1&cache=public',
    'https://example.com/photo.jpg?a=1&b=2',
    null,
  ];
  const fixtures = images.map((image_url, i) => ({
    slug: 'rss-fixture-' + i, title: 'News & planning ' + i,
    published_at: '2026-11-03T12:00:00Z', category: 'theme-parks',
    dek: 'Useful details', body_html: '<p>Full article text &amp; context.</p>', image_url,
  }));
  queries.createArticlesQuery = () => ({ queryArticles: async () => ({ articles: fixtures }) });
  const routePath = require.resolve('../routes/main');
  delete require.cache[routePath];
  try {
    const router = require(routePath);
    const route = router.stack.find(layer => layer.route?.path === '/feed.xml').route;
    let xml;
    await route.stack[0].handle({}, { set() {}, send(value) { xml = value; } });
    const feed = await new Parser().parseString(xml);
    assert.equal(feed.items.length, 3);
    assert.equal(feed.items[0].title, fixtures[0].title);
    assert.equal(feed.items[0].enclosure.url, images[0]);
    assert.equal(feed.items[1].enclosure.url, images[1]);
    assert.match(feed.items[2].enclosure.url, /^https?:\/\//);
    assert.ok(!xml.includes('/storage/v1/render/image/'));
    assert.ok(feed.items.every(item => item['content:encoded'].includes('Full article text')));
  } finally {
    queries.createArticlesQuery = original;
    delete require.cache[routePath];
  }
});
