const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ARTICLE_PLACEHOLDER_PATH,
  articleImageOrigin,
  buildImageBrief,
  contentAddressedName,
  findDuplicateImage,
  imageIdentity,
  isHostedArticleImage,
  isLikelyGenericSourceImage,
  isUsableArticleImage,
  requireArticleImageEnabled,
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
  assert.equal(
    contentAddressedName('story.png', 'a'.repeat(64), { origin: 'generated' }),
    `ai-article-${'a'.repeat(32)}.jpg`
  );
  assert.equal(
    contentAddressedName('story.jpg', 'b'.repeat(64), { origin: 'sourced' }),
    `src-article-${'b'.repeat(32)}.jpg`
  );
  assert.equal(isLikelyGenericSourceImage('https://publisher.test/assets/default-hero.jpg'), true);
  assert.equal(isLikelyGenericSourceImage('https://publisher.test/photos/st-augustine-lights.jpg'), false);
});

test('articleImageOrigin distinguishes AI heroes from sourced photos', () => {
  const base = 'https://project.supabase.co/storage/v1/object/public/article-images';
  assert.equal(articleImageOrigin(`${base}/ai-article-abcdef0123456789abcdef0123456789.jpg`), 'generated');
  assert.equal(articleImageOrigin(`${base}/src-article-abcdef0123456789abcdef0123456789.jpg`), 'sourced');
  assert.equal(articleImageOrigin(`${base}/article-abcdef0123456789abcdef0123456789.jpg`), 'generated');
  assert.equal(articleImageOrigin(`${base}/magic-kingdom-premier-pass.jpg`), 'sourced');
  assert.equal(isHostedArticleImage(`${base}/ai-article-abcdef0123456789abcdef0123456789.jpg`), true);
  assert.equal(articleImageOrigin(ARTICLE_PLACEHOLDER_PATH), null);
});

test('the fallback is a local branded asset rather than a random remote photograph', () => {
  assert.equal(ARTICLE_PLACEHOLDER_PATH, '/images/article-placeholder-v1.svg');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', ARTICLE_PLACEHOLDER_PATH)), true);
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'main.js'), 'utf8');
  assert.doesNotMatch(route, /picsum\.photos/);
});

test('usable story images exclude nulls and the designed coming-soon fallback', () => {
  assert.equal(isUsableArticleImage(null), false);
  assert.equal(isUsableArticleImage(''), false);
  assert.equal(isUsableArticleImage(ARTICLE_PLACEHOLDER_PATH), false);
  assert.equal(isUsableArticleImage('https://picsum.photos/1200/800'), false);
  assert.equal(
    isUsableArticleImage('https://project.supabase.co/storage/v1/object/public/article-images/article-abc.jpg'),
    true
  );
});

test('REQUIRE_ARTICLE_IMAGE defaults on and only disables with exact false', () => {
  assert.equal(requireArticleImageEnabled({}), true);
  assert.equal(requireArticleImageEnabled({ REQUIRE_ARTICLE_IMAGE: 'true' }), true);
  assert.equal(requireArticleImageEnabled({ REQUIRE_ARTICLE_IMAGE: 'false' }), false);
});

test('automate holds publication when a usable story image is missing', () => {
  const automate = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'automate.js'), 'utf8');
  assert.match(automate, /Refusing to publish without a usable story image/);
  assert.match(automate, /requireArticleImageEnabled/);
  assert.match(automate, /isUsableArticleImage\(finalImage\)/);
});

test('homepage feature slots skip articles without usable story images', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'routes', 'main.js'), 'utf8');
  assert.match(main, /isUsableArticleImage/);
  assert.match(main, /newsWithImages/);
  assert.match(main, /Never put a "Story image coming soon" placeholder/);
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
