const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCopy,
  buildTrackingUrl,
  logMarker,
  run,
  selectDailyDiscussion,
} = require('../scripts/buzz-board-social');
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

test('platform copy stays conversation-first and sends readers to the selected discussion', () => {
  const discussion = { slug: 'sample-question', question: 'Which option is actually worth the tradeoff?' };
  const facebook = buildCopy(discussion, 'facebook');
  const instagram = buildCopy(discussion, 'instagram');
  assert.match(facebook, /^Which option/);
  assert.doesNotMatch(facebook, /click here/i);
  assert.match(instagram, /\/buzz\/sample-question\?/);
  assert.match(instagram, /utm_source=instagram/);
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
    facebookPublisher: async (payload) => {
      facebookCalls.push(payload);
      return true;
    },
  });
  assert.equal(result.facebook, 'dry_run');
  assert.equal(result.instagram, 'dry_run');
  assert.equal(facebookCalls[0].logDetail, logMarker('facebook', 'sample-question'));
});
