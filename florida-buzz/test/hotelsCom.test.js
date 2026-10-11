'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hotelsComConfigured,
  hotelsComUrl,
  hotelsComSitePath,
  normalizeHotelsDest,
} = require('../lib/affiliates/hotelsCom');
const {
  getActiveOffers,
  getPrimaryOffer,
  articleShowsPlanningOffers,
} = require('../lib/affiliates');

test('hotelsCom helpers default to Florida Buzz CJ evergreen link', () => {
  const { CJ_EVERGREEN_HOTELS } = require('../lib/affiliates/hotelsCom');
  assert.equal(hotelsComConfigured({}), true);
  assert.equal(hotelsComUrl({}), CJ_EVERGREEN_HOTELS);
  assert.equal(
    hotelsComUrl({ HOTELS_COM_URL: 'https://www.hotels.com/?affcid=test' }),
    'https://www.hotels.com/?affcid=test'
  );
  assert.equal(
    hotelsComUrl(
      {
        HOTELS_COM_URL: 'https://www.hotels.com/?affcid=test',
        HOTELS_COM_URL_DISNEY: 'https://www.hotels.com/deals/disney?affcid=test',
      },
      'disney'
    ),
    'https://www.hotels.com/deals/disney?affcid=test'
  );
});

test('normalizeHotelsDest accepts aliases', () => {
  assert.equal(normalizeHotelsDest('disney-world'), 'disney');
  assert.equal(normalizeHotelsDest('universal-orlando'), 'universal');
  assert.equal(normalizeHotelsDest('canaveral'), 'port-canaveral');
  assert.equal(normalizeHotelsDest('nope'), null);
});

test('hotelsComSitePath builds stable /go/hotels redirects', () => {
  assert.equal(
    hotelsComSitePath('disney', 'https://thefloridabuzz.com'),
    'https://thefloridabuzz.com/go/hotels/disney'
  );
  assert.equal(
    hotelsComSitePath(null, 'https://thefloridabuzz.com'),
    'https://thefloridabuzz.com/go/hotels'
  );
});

test('Hotels.com becomes primary offer when configured', () => {
  const env = { HOTELS_COM_URL: 'https://www.hotels.com/?affcid=demo', SITE_URL: 'https://thefloridabuzz.com' };
  const offers = getActiveOffers(env, { placement: 'planner', limit: 3 });
  assert.equal(offers[0].id, 'hotels-com');
  assert.match(offers[0].url, /\/go\/hotels/);
  assert.equal(offers.some((o) => o.id === 'undercover-tourist'), true);
  assert.equal(getPrimaryOffer(env, { placement: 'home' }).partner, 'Hotels.com');
});

test('article planning offers cover parks, cruises, and travel-deals only', () => {
  assert.equal(articleShowsPlanningOffers('theme-parks'), true);
  assert.equal(articleShowsPlanningOffers('cruises'), true);
  assert.equal(articleShowsPlanningOffers('travel-deals'), true);
  assert.equal(articleShowsPlanningOffers('wildlife'), false);
  assert.equal(articleShowsPlanningOffers('beaches'), false);
});
