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
  // Branded QOTD card — not a bare photo
  assert.ok(buffer.length > 20_000);
});

test('bitmap punctuation normalization preserves the complete wording', () => {
  assert.equal(
    normalizeForBitmap('Disney’s details — which matter most?'),
    "Disney's details - which matter most?"
  );
});

test('the longest approved Disney social hook remains renderable in the Instagram square format', async () => {
  const { FACEBOOK_PRESENTATIONS } = require('../lib/facebookBuzzPresentation');
  const inventory = require('../content/buzz-board-launch-inventory.json');
  const disney = inventory.discussions.filter((d) => d.category === 'disney');
  const longest = disney.reduce((left, right) => {
    const leftHook = FACEBOOK_PRESENTATIONS[left.slug]?.hook || left.question;
    const rightHook = FACEBOOK_PRESENTATIONS[right.slug]?.hook || right.question;
    return rightHook.length > leftHook.length ? right : left;
  });
  const buffer = await renderBuzzSocialImage({
    question: FACEBOOK_PRESENTATIONS[longest.slug].hook,
    category: 'disney',
  });
  const dimensions = imageSize(buffer);
  assert.equal(dimensions.width, 1080);
  assert.equal(dimensions.height, 1080);
});
