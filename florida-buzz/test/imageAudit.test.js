const test = require('node:test');
const assert = require('node:assert/strict');

const {
  easternCalendarStart,
  flagDuplicateImages,
  inspectStoredImage,
  obviousImageIssue,
} = require('../scripts/repair-article-images');

test('14 calendar-day audit starts at Eastern midnight and includes the current date', () => {
  assert.equal(
    easternCalendarStart(14, new Date('2026-10-04T16:00:00Z')),
    '2026-09-21T04:00:00.000Z'
  );
});

test('duplicate audit preserves the oldest canonical image and flags only later reuse', () => {
  const inspected = [
    { article: { slug: 'newer', published_at: '2026-10-04T12:00:00Z' }, fingerprint: 'same', issue: null },
    { article: { slug: 'oldest', published_at: '2026-10-01T12:00:00Z' }, fingerprint: 'same', issue: null },
    { article: { slug: 'distinct', published_at: '2026-10-03T12:00:00Z' }, fingerprint: 'different', issue: null },
  ];
  flagDuplicateImages(inspected);
  assert.equal(inspected.find((row) => row.article.slug === 'oldest').issue, null);
  assert.equal(inspected.find((row) => row.article.slug === 'newer').issue, 'duplicate_recent_image');
  assert.equal(inspected.find((row) => row.article.slug === 'distinct').issue, null);
});

test('missing and placeholder imagery is never classified as complete', () => {
  assert.equal(obviousImageIssue({ image_url: null }), 'missing_image');
  assert.equal(obviousImageIssue({ image_url: '/images/article-placeholder-v1.svg' }), 'placeholder_or_generic_fallback');
  assert.equal(obviousImageIssue({ image_url: 'https://picsum.photos/1200/800' }), 'placeholder_or_generic_fallback');
});

test('stored image audit verifies real bytes and rejects undersized assets', async () => {
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAZAAAADICAIAAADdvUsCAAABFUlEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg1ngABHnYw1AAAAABJRU5ErkJggg==', 'base64');
  const result = await inspectStoredImage(
    { image_url: 'https://storage.example/article.jpg' },
    async () => new Response(tinyPng, { status: 200 })
  );
  assert.equal(result.issue, 'image_too_small_or_unreadable');
  assert.equal(result.dimensions.width, 400);
  assert.equal(result.dimensions.height, 200);
});
