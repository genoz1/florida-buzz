'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const {
  rankStoriesForFeature,
  pickFeaturedThemeParkStories,
  pickMoreThemeParkStories,
  pickAroundFlorida,
} = require('../lib/homePage');

const IMG = 'https://cdn.example.com/story.jpg';

function story(overrides) {
  return {
    slug: 'story',
    title: 'Story',
    category: 'theme-parks',
    image_url: IMG,
    featured: false,
    published_at: '2026-11-01T12:00:00Z',
    ...overrides,
  };
}

test('feature ranking prefers editorially featured, then recency, and drops bad images', () => {
  const ranked = rankStoriesForFeature([
    story({ slug: 'old-feat', featured: true, published_at: '2026-10-01T12:00:00Z' }),
    story({ slug: 'new', featured: false, published_at: '2026-11-05T12:00:00Z' }),
    story({ slug: 'broken', image_url: null }),
    story({ slug: 'new-feat', featured: true, published_at: '2026-11-06T12:00:00Z' }),
  ]);
  assert.deepEqual(ranked.map((a) => a.slug), ['new-feat', 'old-feat', 'new']);
});

test('featured band takes one lead and two side stories without repeats below', () => {
  const rows = [
    story({ slug: 'a', featured: true, published_at: '2026-11-06T12:00:00Z' }),
    story({ slug: 'b', published_at: '2026-11-05T12:00:00Z' }),
    story({ slug: 'c', published_at: '2026-11-04T12:00:00Z' }),
    story({ slug: 'd', published_at: '2026-11-03T12:00:00Z' }),
  ];
  const featured = pickFeaturedThemeParkStories(rows);
  assert.equal(featured.lead.slug, 'a');
  assert.deepEqual(featured.side.map((a) => a.slug), ['b', 'c']);
  assert.deepEqual(pickMoreThemeParkStories(rows, featured.usedSlugs, 6).map((a) => a.slug), ['d']);
});

test('around Florida omits theme parks and used feature slugs', () => {
  const around = pickAroundFlorida(
    {
      beaches: [story({ slug: 'beach-1', category: 'beaches' }), story({ slug: 'a', category: 'beaches' })],
      space: [story({ slug: 'space-1', category: 'space' })],
      'theme-parks': [story({ slug: 'park-x' })],
    },
    ['theme-parks', 'beaches', 'space'],
    new Set(['a']),
    3
  );
  assert.equal(around['theme-parks'], undefined);
  assert.deepEqual(around.beaches.map((a) => a.slug), ['beach-1']);
  assert.deepEqual(around.space.map((a) => a.slug), ['space-1']);
});

test('homepage template is photo-led with theme parks first and no ticker', () => {
  const template = fs.readFileSync(path.join(__dirname, '../views/home.ejs'), 'utf8');
  const header = fs.readFileSync(path.join(__dirname, '../views/partials/header.ejs'), 'utf8');
  assert.match(template, /home-feature-split/);
  assert.match(template, /Florida theme park news/);
  assert.match(template, /All theme park news/);
  assert.match(template, /home-tools-row/);
  assert.match(template, /Around Florida/);
  assert.match(template, /tickerItems:\s*\[\]/);
  assert.match(header, /nav-link-emphasis/);
  assert.match(header, /Theme Parks/);
  assert.doesNotMatch(header.split('nav-links-primary')[1].split('nav-search')[0], /Merch|Sponsors/);
});

test('homepage renders featured lead photo above the headline', () => {
  const template = fs.readFileSync(path.join(__dirname, '../views/home.ejs'), 'utf8');
  const html = ejs.render(
    template,
    {
      featuredLead: story({ slug: 'lead', title: 'Lead Park Story' }),
      featuredSide: [
        story({ slug: 'side-1', title: 'Side One' }),
        story({ slug: 'side-2', title: 'Side Two' }),
      ],
      moreThemeParks: [story({ slug: 'more-1', title: 'More One' })],
      aroundFlorida: {
        beaches: [story({ slug: 'beach-1', title: 'Quiet Beach', category: 'beaches' })],
      },
      guides: [],
      tools: [
        { href: '/wait-times', kicker: 'Live', title: 'Wait Times', blurb: 'Waits' },
        { href: '/planner', kicker: 'Plan', title: 'Day Planner', blurb: 'Plan' },
        { href: '/dining', kicker: 'Eat', title: 'Dining', blurb: 'Eat' },
        { href: '/buzz', kicker: 'Talk', title: 'Buzz Board', blurb: 'Talk' },
      ],
      planningOffers: [],
      undercoverTouristUrl: '',
      podcastShow: null,
      podcastLatest: null,
      podcastRecent: [],
      podcastPlatformLinks: [],
      categoryLabels: {
        'theme-parks': 'Theme Parks',
        beaches: 'Beaches',
      },
      placeholderImg: () => '/images/article-placeholder-v1.svg',
      thumbUrl: (url) => url,
      timeAgo: () => '2h ago',
      include: (name) => (name.includes('header') ? '<header></header>' : name.includes('footer') ? '<footer></footer>' : ''),
    },
    { filename: path.join(__dirname, '../views/home.ejs') }
  );

  assert.match(html, /home-feature-lead/);
  assert.match(html, /Lead Park Story/);
  assert.match(html, /href="\/article\/lead"/);
  assert.match(html, /href="\/wait-times"/);
  assert.match(html, /Around Florida/);
  assert.match(html, /Quiet Beach/);
  const leadBlock = html.slice(html.indexOf('home-feature-lead'), html.indexOf('home-feature-side'));
  assert.ok(leadBlock.indexOf('<img') < leadBlock.indexOf('Lead Park Story'));
});
