'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getActiveOffers,
  getPrimaryOffer,
  newsletterMonetizationHtml,
  amazonSearchUrl,
  OPTIONAL_OFFER_ENV,
} = require('../lib/affiliates');
const {
  CJ_EVERGREEN_BASE,
  undercoverTouristTrackedUrl,
  undercoverTouristDestinationUrl,
} = require('../lib/affiliates/undercoverTourist');

test('getActiveOffers includes Hotels.com primary + soft Undercover Tourist CTA', () => {
  const offers = getActiveOffers({}, { placement: 'wait-times', limit: 5 });
  assert.equal(offers[0].id, 'hotels-com');
  assert.equal(offers.some((o) => o.id === 'undercover-tourist'), true);
  const uct = offers.find((o) => o.id === 'undercover-tourist');
  assert.equal(uct.soft, true);
  assert.match(uct.url, /jdoqocy\.com\/click-101851476-15733832/);
  assert.match(offers[0].url, /\/go\/hotels|jdoqocy\.com\/click-101851476-15734399/);
  assert.match(offers[0].disclosure, /commission/i);
});

test('optional offers appear only when env URLs are configured', () => {
  const empty = getActiveOffers({}, { placement: 'planner', limit: 5 });
  assert.equal(empty.every((o) => o.id === 'undercover-tourist' || o.id === 'hotels-com' || !OPTIONAL_OFFER_ENV.some((d) => d.id === o.id)), true);
  assert.equal(empty.length, 2);

  const withExtras = getActiveOffers(
    {
      TRAVEL_INSURANCE_URL: 'https://example.com/ins',
      AIRPORT_TRANSFER_URL: 'https://example.com/transfer',
      PARKING_DEALS_URL: 'not-a-url',
    },
    { placement: 'planner', limit: 5 }
  );
  assert.equal(withExtras.some((o) => o.id === 'travel-insurance'), true);
  assert.equal(withExtras.some((o) => o.id === 'airport-transfer'), true);
  assert.equal(withExtras.some((o) => o.id === 'parking-deals'), false);
});

test('getPrimaryOffer returns UCT when Hotels.com is not configured', () => {
  const offer = getPrimaryOffer({}, { placement: 'article' });
  assert.equal(offer.partner, 'Undercover Tourist');
  assert.match(offer.cta, /Undercover Tourist|deals|ticket/i);
});

test('getPrimaryOffer prefers Hotels.com when HOTELS_COM_URL is set', () => {
  const offer = getPrimaryOffer(
    { HOTELS_COM_URL: 'https://www.hotels.com/?affcid=x', SITE_URL: 'https://thefloridabuzz.com' },
    { placement: 'article' }
  );
  assert.equal(offer.partner, 'Hotels.com');
  assert.match(offer.url, /\/go\/hotels/);
});

test('newsletter monetization block includes tools + partner disclosure', () => {
  const html = newsletterMonetizationHtml({}, { siteUrl: 'https://thefloridabuzz.com' });
  assert.match(html, /\/wait-times/);
  assert.match(html, /\/planner/);
  assert.match(html, /\/guides/);
  assert.match(html, /Undercover Tourist|commission|partner/i);
  assert.match(html, /nofollow sponsored/);
});

test('amazonSearchUrl uses associates tag without inventing network IDs', () => {
  const url = amazonSearchUrl('disney ears', { AMAZON_ASSOCIATES_TAG: 'floridabuzz-20' });
  assert.match(url, /amazon\.com\/s\?k=disney%20ears/);
  assert.match(url, /tag=floridabuzz-20/);
});

test('undercoverTouristTrackedUrl deep-links hotel destinations via CJ evergreen', () => {
  const url = undercoverTouristTrackedUrl({}, { key: 'disney-world', variant: 'hotel' });
  assert.equal(url.startsWith(CJ_EVERGREEN_BASE), true);
  assert.match(decodeURIComponent(url), /disney-vacation-packages/);
  assert.equal(undercoverTouristDestinationUrl('epic-universe'), 'https://www.undercovertourist.com/epic-universe/');
});
