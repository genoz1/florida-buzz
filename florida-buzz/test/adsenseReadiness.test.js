'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripLegacyTicketCallouts, prepareArticleForDisplay, selectArticlePlanningOffers, additionalSourcesForArticle } = require('../lib/articlePresentation');
const { resolveArticleRedirect, filterRedirectedArticles } = require('../lib/articleRedirects');
const { isIndexableArticle } = require('../lib/articlesQuery');
const { titlesLookLikeDuplicate, findRecentNewsDuplicate } = require('../lib/newsDuplicates');
const legacyBox = '<div class="shop-box"><div class="shop-box-text"><p class="shop-box-eyebrow">Planning Your Trip</p><p>Undercover Tourist is an authorized ticket seller.</p></div><a href="https://www.jdoqocy.com/click-123" class="shop-box-cta">Compare Ticket Prices</a></div>';

test('archived ticket components are removed without losing reporting or product links', () => {
  const reporting = '<p>A supported park update.</p><p>Pack <a href="https://amazon.com/product">this product</a> when relevant.</p>';
  const article = { slug: 'a-story', body_html: reporting + legacyBox + '<p>The final reported fact.</p>' };
  assert.equal(prepareArticleForDisplay(article).body_html, reporting + '<p>The final reported fact.</p>');
  assert.ok(article.body_html.includes('shop-box'));
  assert.equal(stripLegacyTicketCallouts(legacyBox + reporting + legacyBox), reporting);
});

test('custom product callouts and incomplete markup are preserved', () => {
  const custom = '<div class="shop-box"><div class="shop-box-text"><p>A product we discuss.</p></div><a href="https://amazon.com/product" class="shop-box-cta">View product</a></div>';
  assert.equal(stripLegacyTicketCallouts(custom), custom);
  const incomplete = '<p>Reporting before.</p>' + legacyBox.slice(0, -6);
  assert.equal(stripLegacyTicketCallouts(incomplete), incomplete);
  const editorial = '<p>Undercover Tourist is mentioned in the reporting.</p>';
  assert.equal(stripLegacyTicketCallouts(editorial), editorial);
});

test('news has one relevant offer while guides retain two options', () => {
  const offers = [{ id: 'hotels-com' }, { id: 'undercover-tourist' }, { id: 'other' }];
  assert.deepEqual(selectArticlePlanningOffers({ category: 'theme-parks' }, offers), [offers[1]]);
  assert.deepEqual(selectArticlePlanningOffers({ category: 'cruises' }, offers), [offers[0]]);
  assert.deepEqual(selectArticlePlanningOffers({ is_evergreen: true }, offers), offers.slice(0, 2));
  assert.deepEqual(selectArticlePlanningOffers({}, undefined), []);
});

test('the reviewed duplicate redirects and disappears from indexable listings', () => {
  const loser = { slug: 'magic-kingdom-fab-50-statues-removed' };
  const winner = { slug: 'disney-world-fab-50-statues-being-removed' };
  assert.equal(resolveArticleRedirect(loser.slug), winner.slug);
  assert.equal(resolveArticleRedirect(winner.slug), null);
  assert.deepEqual(filterRedirectedArticles([loser, winner]), [winner]);
  assert.equal(isIndexableArticle(loser), false);
  assert.equal(isIndexableArticle(winner), true);
  assert.equal(additionalSourcesForArticle(winner.slug)[0].name, 'WDW Magic');
  assert.deepEqual(additionalSourcesForArticle('unrelated-story'), []);
});

function clientReturning(response) {
  const query = { select() { return this; }, eq() { return this; }, async gte() { return response; } };
  return { from() { return query; } };
}

test('the actual Fab 50 pair is detected without grouping unrelated news', () => {
  assert.equal(titlesLookLikeDuplicate('Disney World Begins Removing Fab 50 Character Statues', 'Disney World Removes Fab 50 Statues From Magic Kingdom'), true);
  assert.equal(titlesLookLikeDuplicate('Disney World Begins Removing Fab 50 Character Statues', 'Universal Orlando Adds New Annual Pass Options'), false);
});

test('failed database checks cannot be mistaken for permission to publish', async () => {
  await assert.rejects(findRecentNewsDuplicate(clientReturning({ data: null, error: { message: 'temporary failure' } }), 'Title', 'theme-parks'), { code: 'duplicate_check_unavailable' });
  await assert.rejects(findRecentNewsDuplicate(clientReturning({ data: null, error: null }), 'Title', 'theme-parks'), { code: 'duplicate_check_unavailable' });
  assert.equal(await findRecentNewsDuplicate(clientReturning({ data: [], error: null }), 'Title', 'theme-parks'), null);
  const row = { slug: 'kept-story', title: 'Disney World Begins Removing Fab 50 Character Statues' };
  assert.equal(await findRecentNewsDuplicate(clientReturning({ data: [row], error: null }), 'Disney World Removes Fab 50 Statues From Magic Kingdom', 'theme-parks'), row);
});
