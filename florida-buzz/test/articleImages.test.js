const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ARTICLE_PLACEHOLDER_PATH,
  buildImageBrief,
  contentAddressedName,
  findDuplicateImage,
  imageIdentity,
  isLikelyGenericSourceImage,
} = require('../lib/articleImages');

test('image relevance metadata preserves the concrete subject, entities, and location', () => {
  assert.deepEqual(buildImageBrief({
    title: 'Fallback title',
    category: 'events',
    image_subject: 'Historic St. Augustine streets illuminated for Nights of Lights',
    image_location: 'St. Augustine, Florida',
    image_entities: ['St. Augustine', 'Nights of Lights', 'St. Augustine'],
  }), {
    subject: 'Historic St. Augustine streets illuminated for Nights of Lights',
    location: 'St. Augustine, Florida',
    entities: ['St. Augustine', 'Nights of Lights'],
    category: 'events',
  });
});

test('representative park, city-event, and beach briefs keep their required real-world cues', () => {
  const cases = [
    ['Universal refillable cups', 'Universal Orlando Resort', ['Universal Orlando Resort', 'refillable cups'], 'theme-parks'],
    ['Disney Park Hopper planning', 'Walt Disney World Resort', ['Walt Disney World', 'Park Hopper'], 'theme-parks'],
    ['SeaWorld Quick Queue entrance', 'SeaWorld Orlando', ['SeaWorld Orlando', 'Quick Queue'], 'theme-parks'],
    ['Historic streets illuminated for Nights of Lights', 'St. Augustine, Florida', ['St. Augustine', 'Nights of Lights'], 'events'],
    ['Shark-tooth sifting on the Gulf beach', 'Venice, Florida', ['Venice Beach', 'shark teeth'], 'beaches'],
  ];
  for (const [subject, location, entities, category] of cases) {
    const brief = buildImageBrief({ image_subject: subject, image_location: location, image_entities: entities, category });
    assert.equal(brief.subject, subject);
    assert.equal(brief.location, location);
    assert.deepEqual(brief.entities, entities);
    assert.equal(brief.category, category);
  }
});

test('exact stored-image reuse is rejected while the designed fallback is intentionally reusable', () => {
  const image = 'https://project.supabase.co/storage/v1/object/public/article-images/article-abc.jpg';
  const recent = [{ slug: 'unrelated-story', title: 'An unrelated story', image_url: image.replace('.jpg', '-thumb.jpg') }];
  assert.equal(findDuplicateImage(image, recent, 'new-story').slug, 'unrelated-story');
  assert.equal(findDuplicateImage(ARTICLE_PLACEHOLDER_PATH, recent, 'new-story'), null);
  assert.equal(imageIdentity(`${image}?cache=1`), image);
});

test('content-addressed names are stable and generic publisher assets are rejected', () => {
  assert.equal(contentAddressedName('story.png', 'a'.repeat(64)), `article-${'a'.repeat(32)}.jpg`);
  assert.equal(isLikelyGenericSourceImage('https://publisher.test/assets/default-hero.jpg'), true);
  assert.equal(isLikelyGenericSourceImage('https://publisher.test/photos/st-augustine-lights.jpg'), false);
});

test('the fallback is a local branded asset rather than a random remote photograph', () => {
  assert.equal(ARTICLE_PLACEHOLDER_PATH, '/images/article-placeholder-v1.svg');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', ARTICLE_PLACEHOLDER_PATH)), true);
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'main.js'), 'utf8');
  assert.doesNotMatch(route, /picsum\.photos/);
});


test('an accepted article hero renders only its canonical image URL', async () => {
  const acceptedImage = 'https://project.supabase.co/storage/v1/object/public/article-images/article-accepted.jpg';
  const filename = path.join(__dirname, '..', 'views', 'article.ejs');
  const html = await ejs.renderFile(filename, {
    article: {
      slug: 'accepted-image', title: 'Accepted image', meta_title: 'Accepted image',
      dek: 'The accepted image must remain visible.', body_html: '<p>Body.</p>', category: 'theme-parks',
      source_name: 'Official source', source_url: 'https://example.com', image_url: acceptedImage,
      published_at: '2026-10-04T12:00:00Z', is_evergreen: false, is_review: false,
    },
    buzzDiscussion: null, related: [], ticker: [], categoryLabels: { 'theme-parks': 'Theme Parks' },
    placeholderImg: () => ARTICLE_PLACEHOLDER_PATH, thumbUrl: (url) => url.replace('.jpg', '-thumb.jpg'),
    resizeImg: (value) => value, timeAgo: () => 'today',
  }, { filename });

  const heroTag = html.match(/<img\b[^>]*data-article-hero-image[^>]*>/)?.[0];
  assert.ok(heroTag, 'article hero image should render');
  assert.match(heroTag, new RegExp(`src="${acceptedImage}"`));
  assert.doesNotMatch(heroTag, /srcset=|onerror=|article-placeholder-v1/);
});
