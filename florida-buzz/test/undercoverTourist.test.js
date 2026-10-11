'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CJ_EVERGREEN_BASE,
  undercoverTouristUrl,
  undercoverTouristTrackedUrl,
  partnerShowNotesHtml,
  partnerDescriptionBlurb,
} = require('../lib/affiliates/undercoverTourist');

test('undercoverTouristUrl uses CJ evergreen base with Disney destination by default', () => {
  const url = undercoverTouristUrl({});
  assert.equal(url.startsWith(CJ_EVERGREEN_BASE), true);
  assert.match(url, /url=/);
  assert.match(decodeURIComponent(url), /undercovertourist\.com\/disney/);
});

test('undercoverTouristUrl prefers UNDERCOVER_TOURIST_URL when set', () => {
  const ready = 'https://example.com/tracked-ut';
  assert.equal(undercoverTouristUrl({ UNDERCOVER_TOURIST_URL: ready }), ready);
});

test('undercoverTouristUrl uses UNDERCOVER_TOURIST_LINK base when set', () => {
  const url = undercoverTouristUrl({ UNDERCOVER_TOURIST_LINK: 'https://www.jdoqocy.com/click-custom-base' });
  assert.match(url, /^https:\/\/www\.jdoqocy\.com\/click-custom-base\?url=/);
});

test('partner show notes and description include disclosure + tracked link', () => {
  const html = partnerShowNotesHtml({});
  assert.match(html, /Undercover Tourist/);
  assert.match(html, /nofollow sponsored/);
  assert.match(html, /commission/i);
  assert.match(html, /jdoqocy\.com\/click-101851476-15733832/);

  const blurb = partnerDescriptionBlurb({});
  assert.match(blurb, /Undercover Tourist/);
  assert.match(blurb, /jdoqocy\.com\/click-101851476-15733832/);
  assert.match(blurb, /commission|partner/i);
});

test('undercoverTouristTrackedUrl can prefer ready URL or deep-link by key', () => {
  const ready = undercoverTouristTrackedUrl(
    { UNDERCOVER_TOURIST_URL: 'https://example.com/ready' },
    { preferReadyUrl: true }
  );
  assert.equal(ready, 'https://example.com/ready');

  const deep = undercoverTouristTrackedUrl(
    { UNDERCOVER_TOURIST_URL: 'https://example.com/ready' },
    { key: 'universal-orlando', preferReadyUrl: false }
  );
  assert.match(decodeURIComponent(deep), /universal-orlando-resort/);
  assert.equal(deep.startsWith(CJ_EVERGREEN_BASE), true);
});
