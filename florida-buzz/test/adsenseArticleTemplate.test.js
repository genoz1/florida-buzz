'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { prepareArticleForDisplay, selectArticlePlanningOffers, additionalSourcesForArticle } = require('../lib/articlePresentation');

test('the consolidated page keeps reporting, both source credits, and one partner offer', () => {
  const views = path.join(__dirname, '../views');
  const article = prepareArticleForDisplay({
    slug: 'disney-world-fab-50-statues-being-removed',
    title: 'Disney World Begins Removing Fab 50 Character Statues',
    dek: 'The reported changes and what visitors should know.',
    body_html: '<p>The reported figures were removed from Magic Kingdom.</p>',
    category: 'theme-parks', source_name: 'Disney Tourist Blog',
    source_url: 'https://www.disneytouristblog.com/disney-world-removing-magicband-character-statues/',
    published_at: '2026-11-26T12:00:00Z', image_url: '/test-image.jpg',
  });
  const offer = { id: 'undercover-tourist', partner: 'Undercover Tourist', eyebrow: 'Park tickets', blurb: 'Compare tickets for your dates.', disclosure: 'We may earn a commission.', cta: 'Compare tickets', url: 'https://www.jdoqocy.com/click-123' };
  const html = ejs.render(fs.readFileSync(path.join(views, 'article.ejs'), 'utf8'), {
    article, additionalSources: additionalSourcesForArticle(article.slug), related: [],
    categoryLabels: { 'theme-parks': 'Theme Parks' }, placeholderImg: () => '/placeholder.svg',
    planningOffers: selectArticlePlanningOffers(article, [offer]),
  }, {
    filename: path.join(views, 'article.ejs'),
    includer(originalPath) {
      return { template: originalPath === 'partials/planning-offers'
        ? fs.readFileSync(path.join(views, 'partials/planning-offers.ejs'), 'utf8') : '' };
    },
  });
  assert.ok(html.includes('The reported figures were removed from Magic Kingdom.'));
  assert.ok(html.includes('disneytouristblog.com/disney-world-removing-magicband-character-statues/'));
  assert.ok(html.includes('wdwmagic.com/events/the-worlds-most-magical-celebration/'));
  assert.equal((html.match(/href="https:\/\/www\.jdoqocy\.com\/click-123"/g) || []).length, 1);
  assert.ok(html.indexOf('The reported figures') < html.indexOf('Compare tickets for your dates.'));
});
