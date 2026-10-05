const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('image-size');
const { Jimp } = require('jimp');

const {
  buildCopy,
  buildFacebookPreview,
  buildInstagramShortTrackingUrl,
  buildShortTrackingUrl,
  buildTrackingUrl,
  categoryForSlot,
  FACEBOOK_COOLDOWN_DAYS,
  INSTAGRAM_COOLDOWN_DAYS,
  logMarker,
  run,
  selectDailyDiscussion,
  selectSocialDiscussion,
} = require('../scripts/buzz-board-social');
const {
  FACEBOOK_PRESENTATIONS,
  buildFacebookImagePrompt,
  ensureInstagramBuzzImage,
  facebookImageFilename,
  instagramImageFilename,
} = require('../lib/facebookBuzzPresentation');
const { getScheduleFlags } = require('../lib/scheduleConfig');

test('Buzz Board social links identify platform, campaign, and discussion without PII', () => {
  const url = new URL(buildTrackingUrl('rope-drop-or-slow-disney-morning', 'facebook'));
  assert.equal(url.pathname, '/buzz/rope-drop-or-slow-disney-morning');
  assert.equal(url.searchParams.get('utm_source'), 'facebook');
  assert.equal(url.searchParams.get('utm_medium'), 'organic_social');
  assert.equal(url.searchParams.get('utm_campaign'), 'buzz_board_launch');
  assert.equal(url.searchParams.get('utm_content'), 'rope-drop-or-slow-disney-morning');
  assert.equal(url.search.includes('@'), false);
});

test('Facebook keeps its clean Florida Buzz redirect and uses a discussion-specific photo asset', () => {
  assert.equal(
    buildShortTrackingUrl('what-universal-does-better-than-disney'),
    'https://thefloridabuzz.com/go/buzz/what-universal-does-better-than-disney'
  );
  assert.equal(facebookImageFilename('what-universal-does-better-than-disney'), 'facebook-buzz-what-universal-does-better-than-disney.jpg');
});

test('Instagram keeps its square discussion photo and honest short discussion path', () => {
  const slug = 'what-universal-does-better-than-disney';
  assert.equal(instagramImageFilename(slug), `instagram-buzz-${slug}.jpg`);
  assert.equal(
    buildInstagramShortTrackingUrl(slug),
    `https://thefloridabuzz.com/go/ig/${slug}`
  );
  const copy = buildCopy({ slug, question: 'Do not repeat this question?' }, 'instagram');
  assert.doesNotMatch(copy, /Do not repeat this question/);
  assert.match(copy, /Does Universal do theme parks better than Disney now\?/);
  assert.match(copy, /Answer here or continue the discussion on Buzz Board/);
  assert.match(copy, /Copy this short address into your browser/);
  assert.match(copy, new RegExp(`/go/ig/${slug}$`));
});

test('every approved launch discussion has an engagement-first hook and exact photo subject', () => {
  const inventory = require('../content/buzz-board-launch-inventory.json');
  assert.equal(Object.keys(FACEBOOK_PRESENTATIONS).length, inventory.discussions.length);
  for (const discussion of inventory.discussions) {
    const presentation = FACEBOOK_PRESENTATIONS[discussion.slug];
    assert.ok(presentation, `missing presentation for ${discussion.slug}`);
    assert.match(presentation.hook, /\?$/);
    assert.ok(presentation.hook.length <= 90, `hook is too long for ${discussion.slug}`);
    assert.ok(presentation.setup.length >= 30);
    assert.ok(presentation.imageSubject.length >= 50);
  }
});

test('photo prompt explicitly rejects branded cards and keeps the exact discussion subject', () => {
  const prompt = buildFacebookImagePrompt({
    slug: 'hollywood-studios-complete-park-day',
    question: 'How would you change Hollywood Studios so it feels like a complete, unhurried park day?',
  });
  assert.match(prompt, /Hollywood Studios/);
  assert.match(prompt, /candid, photorealistic/);
  assert.match(prompt, /No text overlay/);
  assert.match(prompt, /square crop for Instagram/);
});

test('Instagram Buzz Board creative is a 1080-square crop of the reviewed discussion photo', async () => {
  const sourceImage = new Jimp({ width: 1200, height: 800, color: 0x336699ff });
  const sourceBuffer = await sourceImage.getBuffer('image/jpeg', { quality: 80 });
  let stored;
  const bucket = {
    getPublicUrl: (filename) => ({ data: { publicUrl: `https://storage.example/${filename}` } }),
    list: async () => ({ data: [], error: null }),
    download: async () => ({ data: new Blob([sourceBuffer]), error: null }),
  };
  const client = { storage: { from: () => bucket } };
  const url = await ensureInstagramBuzzImage({ slug: 'rope-drop-or-slow-disney-morning' }, {
    client,
    ensureFacebookImage: async () => 'https://storage.example/facebook-buzz-rope-drop-or-slow-disney-morning.jpg',
    store: async (buffer, filename, contentType) => {
      stored = { buffer, filename, contentType };
      return `https://storage.example/${filename}`;
    },
  });
  assert.equal(url, 'https://storage.example/instagram-buzz-rope-drop-or-slow-disney-morning.jpg');
  assert.equal(stored.contentType, 'image/jpeg');
  assert.equal(stored.filename, 'instagram-buzz-rope-drop-or-slow-disney-morning.jpg');
  assert.deepEqual(imageSize(stored.buffer), { height: 1080, type: 'jpg', width: 1080 });
});

test('daily selection is deterministic and rotates approved discussions', () => {
  const discussions = [{ slug: 'one' }, { slug: 'two' }, { slug: 'three' }];
  assert.deepEqual(
    selectDailyDiscussion(discussions, new Date('2026-10-03T16:00:00Z')),
    selectDailyDiscussion(discussions, new Date('2026-10-03T23:00:00Z'))
  );
  assert.notDeepEqual(
    selectDailyDiscussion(discussions, new Date('2026-10-03T16:00:00Z')),
    selectDailyDiscussion(discussions, new Date('2026-10-04T16:00:00Z'))
  );
});

test('social rotation weights Disney and Universal while retaining Cruises and Florida Life', () => {
  const categories = Array.from({ length: 9 }, (_, offset) => {
    const now = new Date(Date.UTC(2026, 9, 1 + offset, 12));
    return categoryForSlot('instagram', 'daily', now);
  });
  assert.equal(categories.filter((value) => value === 'disney').length, 4);
  assert.equal(categories.filter((value) => value === 'universal').length, 3);
  assert.equal(categories.filter((value) => value === 'cruises').length, 1);
  assert.equal(categories.filter((value) => value === 'florida-life').length, 1);
  assert.equal(FACEBOOK_COOLDOWN_DAYS, 10);
  assert.equal(INSTAGRAM_COOLDOWN_DAYS, 21);
});

test('selection excludes discussions inside the platform cooldown and falls back across categories', () => {
  const now = new Date('2026-10-04T16:00:00Z');
  const discussions = [
    { slug: 'disney-a', category: 'disney' },
    { slug: 'universal-a', category: 'universal' },
    { slug: 'cruise-a', category: 'cruises' },
  ];
  const history = [
    { slug: 'disney-a', created_at: '2026-10-03T16:00:00Z' },
    { slug: 'universal-a', created_at: '2026-10-03T16:00:00Z' },
  ];
  assert.equal(selectSocialDiscussion(discussions, history, { platform: 'facebook', slot: 'morning', now }).slug, 'cruise-a');
});

test('platform copy stays conversation-first and sends readers to the selected discussion', () => {
  const discussion = {
    slug: 'hollywood-studios-complete-park-day',
    question: 'How would you change Hollywood Studios so it feels like a complete, unhurried park day?',
  };
  const facebook = buildCopy(discussion, 'facebook');
  const instagram = buildCopy(discussion, 'instagram');
  assert.equal(facebook, 'Hollywood Studios: full-day park or half-day park?');
  assert.doesNotMatch(facebook, /Join the conversation|https?:\/\//);
  assert.match(instagram, /^Hollywood Studios: full-day park or half-day park\?/);
  assert.doesNotMatch(instagram, /Some guests can stay/);
  assert.match(instagram, /\/go\/ig\/hollywood-studios-complete-park-day$/);
  const preview = buildFacebookPreview(discussion);
  assert.equal(preview.unchangedBuzzBoardQuestion, discussion.question);
  assert.equal(preview.destination, 'https://thefloridabuzz.com/go/buzz/hollywood-studios-complete-park-day');
});

test('recurring schedule fails closed unless Buzz Board and both existing Meta publishers are configured', () => {
  const base = {
    BUZZ_BOARD_SOCIAL_ENABLED: 'true',
    BUZZ_BOARD_ENABLED: 'true',
    FB_PAGE_ID: 'page',
    FB_PAGE_ACCESS_TOKEN: 'fb-token',
    INSTAGRAM_USER_ID: 'ig-user',
  };
  assert.equal(getScheduleFlags(base).buzzBoardSocial, false);
  assert.equal(getScheduleFlags({ ...base, INSTAGRAM_ACCESS_TOKEN: 'ig-token' }).buzzBoardSocial, true);
});

test('dry run exercises both publishers without writing post-log state', async () => {
  const rows = [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'sample-question',
    question: 'Which option is actually worth the tradeoff?',
    category: 'florida-life',
    topic: 'Tradeoffs',
    created_at: '2026-10-03T00:00:00Z',
  }];
  const client = {
    from(table) {
      assert.equal(table, 'discussions');
      let orderCount = 0;
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => {
          orderCount += 1;
          return orderCount === 1 ? chain : Promise.resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  };
  const facebookCalls = [];
  const result = await run({
    client,
    dryRun: true,
    facebookImageResolver: async () => 'https://storage.example/facebook-photo.jpg',
    instagramImageResolver: async () => 'https://storage.example/instagram-square.jpg',
    facebookPublisher: async (payload) => {
      facebookCalls.push(payload);
      return true;
    },
  });
  assert.equal(result.facebook, 'dry_run');
  assert.equal(result.instagram, 'dry_run');
  assert.equal(facebookCalls[0].logDetail, logMarker('facebook', 'sample-question'));
  assert.equal(facebookCalls[0].message, 'Which option is actually worth the tradeoff?');
  assert.equal(facebookCalls[0].link, 'https://thefloridabuzz.com/go/buzz/sample-question');
  assert.equal(facebookCalls[0].imageUrl, 'https://storage.example/facebook-photo.jpg');
});

test('article social publishing and both Buzz Board redirect routes remain separate and unchanged', () => {
  const automate = fs.readFileSync(path.join(__dirname, '../scripts/automate.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../routes/main.js'), 'utf8');
  assert.match(automate, /postToFacebook\(\{ title: article\.title, fb_caption: article\.fb_caption, slug, imageUrl: finalImage \}\)/);
  assert.match(automate, /postToInstagram\(\{ caption: toInstagramCaption\(article\.fb_caption\), imageUrl: finalImage \}\)/);
  assert.match(routes, /router\.get\('\/go\/buzz\/:slug'/);
  assert.match(routes, /router\.get\('\/go\/ig\/:slug'/);
});

test('production scheduler spaces three Facebook posts and one Instagram post in Eastern time', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /'30 8 \* \* \*'.*slot: 'morning'/);
  assert.match(server, /'15 14 \* \* \*'.*slot: 'afternoon'/);
  assert.match(server, /'30 21 \* \* \*'.*slot: 'evening'/);
  assert.match(server, /SOCIAL_PLATFORM=instagram BUZZ_SOCIAL_SLOT=daily/);
  assert.match(server, /timezone: 'America\/New_York'/);
});
