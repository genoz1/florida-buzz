'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CJ_EVERGREEN_BASE,
  undercoverTouristUrl,
  undercoverTouristTrackedUrl,
  undercoverTouristSitePath,
  partnerShowNotesHtml,
  partnerDescriptionBlurb,
  rewritePartnerDescriptionLink,
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

test('partner show notes and description use short /go/undercover link', () => {
  const html = partnerShowNotesHtml({});
  assert.match(html, /Undercover Tourist/);
  assert.match(html, /nofollow sponsored/);
  assert.match(html, /commission/i);
  assert.match(html, /thefloridabuzz\.com\/go\/undercover/);
  assert.doesNotMatch(html, /jdoqocy\.com/);

  const blurb = partnerDescriptionBlurb({});
  assert.match(blurb, /Undercover Tourist/);
  assert.match(blurb, /thefloridabuzz\.com\/go\/undercover/);
  assert.doesNotMatch(blurb, /jdoqocy\.com/);
  assert.match(blurb, /commission|partner/i);
  assert.equal(undercoverTouristSitePath('https://thefloridabuzz.com'), 'https://thefloridabuzz.com/go/undercover');
});

test('rewritePartnerDescriptionLink replaces raw CJ UCT URLs', () => {
  const raw =
    'Geno covers parks. Partner: Undercover Tourist for Disney tickets & hotels — https://www.jdoqocy.com/click-101851476-15733832?url=https%3A%2F%2Fwww.undercovertourist.com%2Fdisney%2F. Undercover Tourist is a Florida Buzz partner.';
  const fixed = rewritePartnerDescriptionLink(raw);
  assert.match(fixed, /thefloridabuzz\.com\/go\/undercover/);
  assert.doesNotMatch(fixed, /jdoqocy\.com/);
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
