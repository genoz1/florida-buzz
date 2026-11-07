'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { homePlaceTag } = require('../lib/homePlaceTag');

test('homePlaceTag uses named places from title/dek only', () => {
  assert.equal(homePlaceTag({ title: 'Disney World’s Key Holiday Dates' }), 'Disney World');
  assert.equal(homePlaceTag({ title: 'A New Wizard Card Arrives at Universal Orlando' }), 'Universal Orlando');
  assert.equal(homePlaceTag({ title: 'Holiday Flavors at Disney Springs' }), 'Disney Springs');
  assert.equal(homePlaceTag({ title: 'Quiet Florida beaches reopen' }), 'Theme Parks');
});
