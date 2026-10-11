const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { firstCommentMessage } = require('../lib/facebook');
const {
  normalizePinCopy,
  toFacebookFeedCaption,
  toInstagramCaption,
  toThreadsPost,
} = require('../lib/socialCopy');
const { parseBuzzFacebookSlots } = require('../lib/scheduleConfig');

test('Facebook first-comment messages differ for articles, guides, and Buzz Board', () => {
  assert.equal(
    firstCommentMessage('https://thefloridabuzz.com/article/example', 'article'),
    'Full story:\nhttps://thefloridabuzz.com/article/example'
  );
  assert.equal(
    firstCommentMessage('https://thefloridabuzz.com/article/guide', 'guide'),
    'Full guide:\nhttps://thefloridabuzz.com/article/guide'
  );
  assert.match(
    firstCommentMessage('https://thefloridabuzz.com/go/buzz/sample', 'buzz_board'),
    /Buzz Board/
  );
  assert.match(
    firstCommentMessage('https://thefloridabuzz.com/go/buzz/sample', 'buzz_board'),
    /go\/buzz\/sample/
  );
});

test('article Facebook captions keep curiosity-gap hooks and comment CTAs without URLs', () => {
  const withLegacySuffix = toFacebookFeedCaption(
    'Disney just changed something about Lightning Lane pricing this week. ⚡ Full story ↓'
  );
  assert.match(withLegacySuffix, /Lightning Lane/);
  assert.doesNotMatch(withLegacySuffix, /Full story/i);
  assert.doesNotMatch(withLegacySuffix, /https?:\/\//);
  assert.match(withLegacySuffix, /tell us below|what would you do/i);

  const alreadyHasCta = toFacebookFeedCaption(
    'Universal quietly adjusted park hours for a busy weekend — would you change your plan?'
  );
  assert.equal(
    alreadyHasCta,
    'Universal quietly adjusted park hours for a busy weekend — would you change your plan?'
  );
});

test('Instagram captions are comment-first with a short focused hashtag set', () => {
  const caption = toInstagramCaption(
    'Disney just changed something about Lightning Lane pricing this week. Full story ↓',
    'theme-parks'
  );
  assert.match(caption, /Comment below|would you do/i);
  assert.match(caption, /link in bio/i);
  assert.match(caption, /#DisneyWorld/);
  assert.match(caption, /#FloridaBuzz/);
  assert.equal((caption.match(/#/g) || []).length, 4);
  assert.doesNotMatch(caption, /Full story ↓/);
});

test('Threads posts lead with conversation and keep the link secondary', () => {
  const text = toThreadsPost(
    'Disney just changed something about Lightning Lane pricing this week. Full story ↓',
    'https://thefloridabuzz.com/article/lightning-lane'
  );
  const linkIndex = text.indexOf('https://thefloridabuzz.com/article/lightning-lane');
  assert.ok(linkIndex > 0);
  assert.ok(text.indexOf('Lightning Lane') < linkIndex);
  assert.match(text, /Agree or push back/i);
  assert.doesNotMatch(text, /Full story/i);
});

test('Pinterest pin copy gains search context when the AI title is weak', () => {
  const weak = normalizePinCopy({
    pin_title: 'New pricing details travelers should know',
    pin_description: 'Useful update for anyone watching the numbers.',
    category: 'theme-parks',
  });
  assert.match(weak.pin_title, /Florida Theme Parks/);
  assert.match(weak.pin_description, /Florida/);
  assert.ok(weak.pin_title.length <= 100);
  assert.ok(weak.pin_description.length <= 500);

  const strong = normalizePinCopy({
    pin_title: 'Magic Kingdom Lightning Lane price change — Florida planning tip',
    pin_description: 'What Florida Disney visitors should know when planning a park day.',
    category: 'theme-parks',
  });
  assert.equal(
    strong.pin_title,
    'Magic Kingdom Lightning Lane price change — Florida planning tip'
  );
});

test('Buzz Board Facebook cadence env knob selects a subset of slots', () => {
  assert.deepEqual(
    parseBuzzFacebookSlots(undefined).map((slot) => slot.slot),
    ['morning', 'afternoon', 'evening']
  );
  assert.deepEqual(
    parseBuzzFacebookSlots('morning,evening').map((slot) => slot.slot),
    ['morning', 'evening']
  );
  assert.deepEqual(
    parseBuzzFacebookSlots('nope').map((slot) => slot.slot),
    ['morning', 'afternoon', 'evening']
  );
});

test('article automation posts Facebook with first_comment link placement', () => {
  const automate = fs.readFileSync(path.join(__dirname, '../scripts/automate.js'), 'utf8');
  assert.match(automate, /linkPlacement:\s*'first_comment'/);
  assert.match(automate, /linkCommentKind:\s*'article'/);
  assert.match(automate, /toFacebookFeedCaption\(fb_caption\)/);
  assert.match(automate, /toInstagramCaption\(article\.fb_caption,\s*article\.category\)/);
  assert.match(automate, /normalizePinCopy/);
});

test('engagement posts stay link-free in captions and prefer first_comment if a link appears later', () => {
  const engagement = fs.readFileSync(path.join(__dirname, '../scripts/engagement-post.js'), 'utf8');
  assert.match(engagement, /No links/);
  assert.match(engagement, /linkPlacement:\s*'first_comment'/);
  assert.match(engagement, /link:\s*null/);
  assert.match(engagement, /strong first-line hook/);
  assert.match(engagement, /never engagement-bait/);
});
