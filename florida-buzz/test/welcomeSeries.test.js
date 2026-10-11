'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWelcomeEmails,
  buildWelcomeEmail,
  sendWelcomeEmail,
  gapAfterStep,
  afterSubscribeWelcome,
  STEP_DELAYS_MS,
} = require('../lib/email/welcomeSeries');
const { buildDigestHtml } = require('../scripts/newsletter');

test('welcome series has 4 value-first emails with tools, partner CTA, and disclosure', () => {
  const series = buildWelcomeEmails(
    { SITE_URL: 'https://thefloridabuzz.com', TRAVEL_INSURANCE_URL: 'https://example.com/ins' },
    { email: 'reader@example.com' }
  );
  assert.equal(series.length, 4);
  assert.equal(STEP_DELAYS_MS.length, 4);

  for (const message of series) {
    assert.ok(message.subject);
    assert.match(message.html, /unsubscribe/i);
    assert.match(message.html, /thefloridabuzz\.com/);
    assert.match(message.html, /commission|partner|affiliate/i);
  }

  assert.match(series[0].html, /\/wait-times/);
  assert.match(series[0].html, /\/planner/);
  assert.match(series[1].html, /\/wait-times/);
  assert.match(series[2].html, /\/guides/);
  assert.match(series[3].html, /\/podcasts/);
  assert.match(series[0].html, /jdoqocy\.com\/click-101851476-15733832|Undercover Tourist/);
  assert.match(series[2].html, /example\.com\/ins/);
});

test('sendWelcomeEmail dry-run returns step 0 content without Resend', async () => {
  const result = await sendWelcomeEmail({
    email: 'new@example.com',
    env: { SITE_URL: 'https://thefloridabuzz.com' },
    dryRun: true,
  });
  assert.equal(result.sent, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.step, 0);
  assert.match(result.subject, /Welcome to Florida Buzz/i);
});

test('gapAfterStep spaces nurture follow-ups by at least one day', () => {
  assert.ok(gapAfterStep(0) >= 24 * 60 * 60 * 1000);
  assert.ok(gapAfterStep(1) >= 24 * 60 * 60 * 1000);
  assert.equal(gapAfterStep(3), null);
});

test('afterSubscribeWelcome records nurture step when supabase upsert works', async () => {
  const upserts = [];
  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'subscriber_nurture');
      return {
        upsert(payload) {
          upserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const result = await afterSubscribeWelcome(fakeSupabase, 'trip@example.com', {
    env: { SITE_URL: 'https://thefloridabuzz.com' },
    dryRun: true,
  });
  assert.equal(result.sent, true);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].email, 'trip@example.com');
  assert.equal(upserts[0].step, 0);
  assert.ok(upserts[0].next_at);
});

test('daily digest includes automated monetization tools block', () => {
  const html = buildDigestHtml(
    [{ slug: 'test-story', title: 'Test', dek: 'Dek', category: 'theme-parks' }],
    'https://thefloridabuzz.com/unsubscribe?email=a%40b.com',
    {}
  );
  assert.match(html, /Plan the trip with free tools/);
  assert.match(html, /\/wait-times/);
  assert.match(html, /Undercover Tourist|commission/i);
});

test('buildWelcomeEmail is the first series message', () => {
  const first = buildWelcomeEmail({}, { email: 'a@b.com' });
  assert.equal(first.step, 0);
  assert.match(first.html, /Glad you/);
});
