const test = require('node:test');
const assert = require('node:assert/strict');
const { imageSize } = require('image-size');

const {
  normalizeForBitmap,
  renderBuzzSocialImage,
} = require('../lib/buzzSocialImage');

test('question image renderer produces a reusable 1080 square PNG', async () => {
  const buffer = await renderBuzzSocialImage({
    category: 'universal',
    question: 'Where does Universal Orlando outperform Disney in ways Disney fans are reluctant to admit?',
  });
  const dimensions = imageSize(buffer);
  assert.equal(dimensions.type, 'png');
  assert.equal(dimensions.width, 1080);
  assert.equal(dimensions.height, 1080);
});

test('bitmap punctuation normalization preserves the complete wording', () => {
  assert.equal(
    normalizeForBitmap('Disney’s details — which matter most?'),
    "Disney's details - which matter most?"
  );
});
