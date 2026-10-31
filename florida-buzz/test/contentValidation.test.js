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
    image_subject: 'The named Florida attraction in its real setting', image_location: 'Orlando, Florida',
    image_entities: ['Florida attraction', 'Orlando'],
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

test('a numbered food headline must deliver the promised items, not a vague teaser', () => {
  const article={title:'8 New Bites and Sips to Seek Out at Animal Kingdom',meta_title:'Animal Kingdom Food',category:'theme-parks',dek:'New menu additions.',body_html:'<p>There are eight new items. Korean barbecue and pasta are among the additions, with new cocktails in Pandora. Visit the park to find out more.</p>',...social,image_subject:'Animal Kingdom',image_location:'Orlando',image_entities:['Animal Kingdom']};
  assert.throws(()=>validateNewsArticle(article),/Headline promises a list/);
  article.body_html='<ol>'+Array.from({length:8},(_,i)=>'<li>Named item '+i+' at its supported dining location.</li>').join('')+'</ol>';
  assert.doesNotThrow(()=>validateNewsArticle(article));
  article.title='2027 Disney World Planning Update';article.body_html=body;
  assert.doesNotThrow(()=>validateNewsArticle(article));
});

test('spelled-out list promises are checked in both news and guides', () => {
  const guide = { title: 'Three Restaurants to Try in Orlando', dek: 'A specific dining shortlist.', body_html: body, ...social };
  assert.throws(() => validateGuide(guide), /Headline promises a list/);
  const article = { ...guide, meta_title: 'Orlando Restaurants', category: 'food', image_subject: 'Orlando restaurant', image_location: 'Orlando', image_entities: ['Orlando'] };
  assert.throws(() => validateNewsArticle(article), /Headline promises a list/);
  guide.body_html = '<ul><li>First supported restaurant and its details.</li><li>Second supported restaurant and its details.</li><li>Third supported restaurant and its details.</li></ul>';
  assert.doesNotThrow(() => validateGuide(guide));
  assert.doesNotThrow(() => validateNewsArticle({ ...article, body_html: guide.body_html }));
  assert.doesNotThrow(() => validateGuide({ ...guide, title: 'Four Seasons Orlando Planning Guide', body_html: body }));
});
