'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAlertEmail,
  buildHealthReport,
  findArticlesMissingImages,
  parseLinkMarker,
  summarizePostLog,
} = require('../lib/opsHealthCheck');
const { extractUrlFromText } = require('../lib/postLog');

test('parseLinkMarker detects present, missing, and absent markers', () => {
  assert.deepEqual(parseLinkMarker('hello [link:https://thefloridabuzz.com/article/x]'), {
    present: true,
    missing: false,
    value: 'https://thefloridabuzz.com/article/x',
  });
  assert.deepEqual(parseLinkMarker('ok [link:MISSING]'), {
    present: true,
    missing: true,
    value: null,
  });
  assert.equal(parseLinkMarker('legacy caption with no marker').present, false);
});

test('summarizePostLog counts quiet platforms, failures, and missing links', () => {
  const summary = summarizePostLog([
    { platform: 'facebook', status: 'success', detail: 'Hook [link:https://thefloridabuzz.com/article/a]' },
    { platform: 'facebook', status: 'success', detail: 'No url [link:MISSING]' },
    { platform: 'instagram', status: 'failed', detail: 'rate limit' },
    { platform: 'pinterest', status: 'success', detail: 'Pin title [link:https://thefloridabuzz.com/article/a]' },
    { platform: 'threads', status: 'success', detail: 'Agree? [link:https://thefloridabuzz.com/article/a]' },
  ]);
  assert.equal(summary.facebook.success, 2);
  assert.equal(summary.facebook.missingLink, 1);
  assert.equal(summary.instagram.success, 0);
  assert.equal(summary.instagram.failed, 1);
  assert.equal(summary.pinterest.success, 1);
  assert.equal(summary.threads.missingLink, 0);
});

test('findArticlesMissingImages uses usability helper', () => {
  const rows = findArticlesMissingImages(
    [
      { slug: 'good', title: 'Good', image_url: 'https://cdn.example/a.jpg' },
      { slug: 'blank', title: 'Blank', image_url: null },
      { slug: 'placeholder', title: 'Soon', image_url: 'https://picsum.photos/800' },
    ],
    {
      isUsableArticleImage: (url) => Boolean(url) && !/picsum/i.test(url),
    }
  );
  assert.deepEqual(rows.map((r) => r.slug), ['blank', 'placeholder']);
});

test('buildHealthReport marks missing photos and missing links as critical', () => {
  const report = buildHealthReport({
    platformSummary: summarizePostLog([
      { platform: 'facebook', status: 'success', detail: 'x [link:MISSING]' },
      { platform: 'instagram', status: 'success', detail: 'y [link:https://thefloridabuzz.com/a]' },
      { platform: 'pinterest', status: 'success', detail: 'z [link:https://thefloridabuzz.com/a]' },
      { platform: 'threads', status: 'success', detail: 'w [link:https://thefloridabuzz.com/a]' },
    ]),
    missingImages: [{ slug: 'no-photo', title: 'No photo', published_at: '2026-11-05T12:00:00Z' }],
  });
  assert.equal(report.ok, false);
  assert.ok(report.criticalCount >= 2);
  assert.ok(report.issues.some((i) => i.code === 'facebook_missing_link'));
  assert.ok(report.issues.some((i) => i.code === 'articles_missing_images'));
  const email = buildAlertEmail(report, { siteUrl: 'https://thefloridabuzz.com' });
  assert.match(email.subject, /critical/i);
  assert.match(email.html, /no-photo/);
  assert.match(email.html, /Missing links|missing-link|🔗 miss/i);
});

test('extractUrlFromText pulls the first http(s) URL', () => {
  assert.equal(
    extractUrlFromText('Full story:\nhttps://thefloridabuzz.com/article/demo\n\n#FloridaBuzz'),
    'https://thefloridabuzz.com/article/demo'
  );
  assert.equal(extractUrlFromText('no link here'), null);
});

test('server schedules digest and issues-only publishing self-checks', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /post-health-check\.js/);
  assert.match(server, /OPS_HEALTH_MODE=issues_only/);
  assert.match(server, /15 8 \* \* \*/);
  assert.match(server, /20 10,14,18,22 \* \* \*/);
});
