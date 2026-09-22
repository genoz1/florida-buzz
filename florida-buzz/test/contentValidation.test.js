const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateNewsArticle, validateGuide, validateTopic, validateReview,
  validateRoundup, validateEngagementPost, validateFeaturePromo,
  validateDiningDirectory,
} = require('../lib/contentValidation');

const body = '<p>This is a complete representative Florida Buzz article paragraph with enough detail to pass publication validation.</p>';
const social = {
  fb_caption: 'A specific Florida update is worth a closer look. Full story ↓',
  pin_title: 'Florida Travel Update and Planning Guide',
  pin_description: 'Current Florida travel information for residents and visitors planning a trip.',
};

test('article-producing workflows accept complete representative output', () => {
  assert.doesNotThrow(() => validateNewsArticle({
    title: 'Florida Attraction Announces an Update', meta_title: 'Florida Attraction Update 2026',
    category: 'theme-parks', dek: 'A concise explanation of what changed.', body_html: body, ...social,
  }));
  assert.doesNotThrow(() => validateGuide({
    title: 'A Practical Florida Planning Guide', dek: 'What to know before visiting.', body_html: body,
    ...social, fb_caption: 'Plan this Florida stop with current details. Full guide ↓',
  }));
  assert.doesNotThrow(() => validateTopic({ topic: 'Current Florida park procedure', working_title: 'Florida Park Procedure Guide' }));
  assert.doesNotThrow(() => validateReview({
    title: 'My Florida Restaurant Review', meta_title: 'Florida Restaurant Review',
    dek: 'My firsthand experience and practical verdict.', body_html: body,
    ...social, fb_caption: 'My verdict may surprise regular visitors. Full review ↓',
  }));
  assert.doesNotThrow(() => validateRoundup({
    title: 'What to Do This Weekend in Orlando', meta_title: 'Orlando Events This Weekend',
    dek: 'A selection of current events around Orlando.', body_html: body, fb_caption: 'Orlando has a busy weekend ahead. 🎉',
  }));
});

test('non-article workflows accept complete representative output', () => {
  assert.doesNotThrow(() => validateEngagementPost({ topic: 'beach-vs-springs', message: '❤️ for beaches or 👍 for springs? React with your pick!' }));
  assert.doesNotThrow(() => validateFeaturePromo({ message: 'Check current park waits before choosing your next ride.', pin_title: social.pin_title, pin_description: social.pin_description }));
  assert.doesNotThrow(() => validateDiningDirectory([{
    name: 'Sample Restaurant', land: 'Sample Resort', service_type: 'table-service',
    reservations: 'recommended', dining_plan: null, character_dining: false,
    characters: null, meal_periods: ['dinner'], description: 'A useful, current description of this dining location.',
  }]));
});

test('malformed and incomplete output cannot pass publication validation', () => {
  assert.throws(() => validateNewsArticle({ title: 'Only a title' }), /meta_title/);
  assert.throws(() => validateNewsArticle({
    title: 'Title', meta_title: 'Meta', category: 'unknown', dek: 'Dek', body_html: body, ...social,
  }), /category/);
  assert.throws(() => validateGuide({ title: 'Guide', dek: 'Dek', body_html: '<p>cut off', ...social }), /body_html/);
  assert.throws(() => validateReview({ title: 'Review' }), /meta_title/);
  assert.throws(() => validateDiningDirectory([]), /at least one/);
});
