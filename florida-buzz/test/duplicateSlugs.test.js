'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  numberedSuffix,
  preferredCanonicalFromSet,
  filterNumberedDuplicateLosers,
} = require('../lib/duplicateSlugs');
const { articleSitemapUrls } = require('../lib/sitemapBuilder');

test('numberedSuffix only matches short serial suffixes', () => {
  assert.deepEqual(numberedSuffix('echo-lake-2'), { base: 'echo-lake', n: 2 });
  assert.deepEqual(numberedSuffix('echo-lake-17'), { base: 'echo-lake', n: 17 });
  assert.equal(numberedSuffix('echo-lake'), null);
  assert.equal(numberedSuffix('echo-lake-2026'), null);
  assert.equal(numberedSuffix('story-mw9988jz'), null);
});

test('preferredCanonicalFromSet only consolidates onto a bare winner', () => {
  const set = new Set(['echo-lake', 'echo-lake-2', 'echo-lake-3']);
  assert.equal(preferredCanonicalFromSet('echo-lake-3', set), 'echo-lake');
  assert.equal(preferredCanonicalFromSet('echo-lake-2', set), 'echo-lake');
  assert.equal(preferredCanonicalFromSet('echo-lake', set), null);

  const onlySerial = new Set(['echo-lake-2', 'echo-lake-4']);
  assert.equal(preferredCanonicalFromSet('echo-lake-4', onlySerial), null);
  assert.equal(preferredCanonicalFromSet('echo-lake-2', onlySerial), null);
});

test('filterNumberedDuplicateLosers drops losers only when bare exists', () => {
  const rows = [
    { slug: 'echo-lake', title: 'Bare' },
    { slug: 'echo-lake-2', title: 'Two' },
    { slug: 'echo-lake-3', title: 'Three' },
    { slug: 'unique-story', title: 'Solo' },
    { slug: 'other-2', title: 'Orphan two' },
  ];
  const kept = filterNumberedDuplicateLosers(rows).map((a) => a.slug).sort();
  assert.deepEqual(kept, ['echo-lake', 'other-2', 'unique-story']);
});

test('article sitemap drops numbered losers when the bare slug exists', () => {
  const urls = articleSitemapUrls('https://thefloridabuzz.com', [
    { slug: 'echo-lake', title: 'Bare', published_at: '2026-11-01' },
    { slug: 'echo-lake-2', title: 'Two', published_at: '2026-11-02' },
    { slug: 'good-story', title: 'Good', published_at: '2026-11-03', is_evergreen: true },
  ]);
  const locs = urls.map((u) => u.loc);
  assert.ok(locs.includes('https://thefloridabuzz.com/article/echo-lake'));
  assert.ok(!locs.includes('https://thefloridabuzz.com/article/echo-lake-2'));
  assert.ok(locs.includes('https://thefloridabuzz.com/article/good-story'));
  assert.equal(urls.find((u) => u.loc.endsWith('/good-story')).priority, '0.7');
});
