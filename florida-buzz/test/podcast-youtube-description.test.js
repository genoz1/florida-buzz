'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildYoutubeDescription,
  extractHtmlLinks,
} = require('../lib/podcasts/youtubeDescription');

test('extractHtmlLinks keeps href URLs that stripHtml would drop', () => {
  const links = extractHtmlLinks(
    '<p>See <a href="https://thefloridabuzz.com/article/demo?utm_source=podcast">Demo Article</a></p>'
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].title, 'Demo Article');
  assert.match(links[0].url, /^https:\/\/thefloridabuzz\.com\/article\/demo/);
});

test('buildYoutubeDescription puts Florida Buzz first with like/subscribe and real links', () => {
  const description = buildYoutubeDescription({
    site: 'https://thefloridabuzz.com',
    show: { slug: 'florida-buzz-disney' },
    episode: {
      slug: 'weekly-test',
      title: 'Test Episode',
      description: 'Geno talks through this week at Walt Disney World.',
      show_notes_html: `
        <p>Notes</p>
        <h2>Florida Buzz Resources Mentioned</h2>
        <ul>
          <li><a href="https://thefloridabuzz.com/article/premier-pass?utm_source=podcast">Premier Pass</a></li>
          <li><a href="https://thefloridabuzz.com/article/gertie?utm_source=podcast">Gertie</a></li>
        </ul>
      `,
    },
    sources: [
      {
        included: true,
        title: 'Wine & Dine',
        url: 'https://thefloridabuzz.com/article/wine-dine?utm_source=podcast',
      },
    ],
  });

  assert.ok(description.startsWith('https://thefloridabuzz.com\n'));
  assert.match(description, /^https:\/\/thefloridabuzz\.com\nhttps:\/\/thefloridabuzz\.com\/podcasts\/florida-buzz-disney\/weekly-test/m);
  assert.match(description, /like and subscribe/i);
  assert.match(description, /Links from this episode:/);
  assert.match(description, /Premier Pass[\s\S]*https:\/\/thefloridabuzz\.com\/article\/premier-pass/);
  assert.match(description, /Wine & Dine[\s\S]*https:\/\/thefloridabuzz\.com\/article\/wine-dine/);
  assert.match(description, /not affiliated with or endorsed by Disney/i);
});

test('pipeline and admin wire description builder + refresh route', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../lib/podcasts/routerAdmin.js'), 'utf8');
  const cards = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoCards.js'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../views/admin-podcast-episode.ejs'), 'utf8');
  assert.match(pipeline, /buildYoutubeDescription/);
  assert.match(pipeline, /updatePublishedDescription/);
  assert.match(pipeline, /Like & Subscribe/);
  assert.match(admin, /youtube-stills\/update-description/);
  assert.match(cards, /Like & Subscribe/);
  assert.match(view, /Refresh YouTube description/);
});
