'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const { SOCIAL_PROFILES, socialProfileUrls } = require('../lib/socialProfiles');
const { homePlaceTag } = require('../lib/homePlaceTag');

test('social profiles point at Florida Buzz accounts, not generic homepages', () => {
  const byId = Object.fromEntries(SOCIAL_PROFILES.map((p) => [p.id, p.href]));
  assert.match(byId.facebook, /facebook\.com\/p\/Florida-Buzz-61591508674320\/?/i);
  assert.match(byId.instagram, /instagram\.com\/floridabuzzonline/i);
  assert.match(byId.threads, /threads\.net\/@floridabuzzonline/i);
  assert.match(byId.pinterest, /pinterest\.com\/floridabuzzonline/i);
  assert.match(byId.youtube, /youtube\.com\/@TheFloridaBuzz/);
  assert.equal(socialProfileUrls().length, SOCIAL_PROFILES.length);
});

test('footer and schema use the shared social profile list', () => {
  const footer = fs.readFileSync(path.join(__dirname, '../views/partials/footer.ejs'), 'utf8');
  const header = fs.readFileSync(path.join(__dirname, '../views/partials/header.ejs'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(footer, /socialProfiles/);
  assert.doesNotMatch(footer, /href="https:\/\/facebook\.com"/);
  assert.match(header, /sameAs/);
  assert.match(server, /socialProfiles/);
});

test('home place tags only fire on named places', () => {
  assert.equal(homePlaceTag({ title: 'Disney World’s Key Holiday Dates' }), 'Disney World');
  assert.equal(homePlaceTag({ title: 'A New Wizard Card Arrives at Universal Orlando' }), 'Universal Orlando');
  assert.equal(homePlaceTag({ title: 'Holiday Flavors at Disney Springs' }), 'Disney Springs');
  assert.equal(homePlaceTag({ title: 'Statewide park tip roundup' }), 'Theme Parks');
});
