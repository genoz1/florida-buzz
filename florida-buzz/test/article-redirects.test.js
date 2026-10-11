'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveArticleRedirect,
  filterRedirectedArticles,
  isRedirectedArticleSlug,
} = require('../lib/articleRedirects');
const { pickByline, GUIDE_BYLINE } = require('../scripts/generate-guide');

test('FWC duplicate slug permanently redirects to the kept article', () => {
  assert.equal(
    resolveArticleRedirect('fwc-wildlife-safety-tips-after-major-storms'),
    'florida-wildlife-safety-tips-after-a-major-storm'
  );
  assert.equal(resolveArticleRedirect('florida-wildlife-safety-tips-after-a-major-storm'), null);
  assert.equal(isRedirectedArticleSlug('fwc-wildlife-safety-tips-after-major-storms'), true);
});

test('listing helpers hide redirected duplicate losers', () => {
  const rows = filterRedirectedArticles([
    { slug: 'florida-wildlife-safety-tips-after-a-major-storm' },
    { slug: 'fwc-wildlife-safety-tips-after-major-storms' },
    { slug: 'other-story' },
  ]);
  assert.deepEqual(
    rows.map((r) => r.slug),
    ['florida-wildlife-safety-tips-after-a-major-storm', 'other-story']
  );
});

test('evergreen guide byline is always Gene Zentko', () => {
  assert.equal(GUIDE_BYLINE, 'Gene Zentko');
  assert.equal(pickByline('beaches', 'Best springs near Orlando'), 'Gene Zentko');
  assert.equal(pickByline('theme-parks', 'Universal Epic Universe tips'), 'Gene Zentko');
  assert.equal(pickByline('wildlife', 'Manatee season guide'), 'Gene Zentko');
});
