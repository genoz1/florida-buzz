'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  titleSimilarity,
  contentTitleOverlap,
  titlesLookLikeDuplicate,
} = require('../scripts/automate');

test('Key West sargassum paraphrases are treated as duplicates', () => {
  const a = 'Key West Weighs Sargassum Cleanup Pilot Along Atlantic Shore';
  const b = 'Key West Studies Pilot Cleanup for Rotting Sargassum';
  assert.ok(titleSimilarity(a, b) < 0.5, 'Jaccard alone still misses this pair');
  assert.ok(contentTitleOverlap(a, b) >= 0.6);
  assert.equal(titlesLookLikeDuplicate(a, b), true);
});

test('unrelated beach titles are not duplicates', () => {
  const a = 'Key West Weighs Sargassum Cleanup Pilot Along Atlantic Shore';
  const b = 'Clearwater Beach Named Top Spot for Spring Break Travelers';
  assert.equal(titlesLookLikeDuplicate(a, b), false);
});
