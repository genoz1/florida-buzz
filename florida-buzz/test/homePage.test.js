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
const { homePlaceTag } = require('../lib/homePlaceTag');

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
  const footer = fs.readFileSync(path.join(__dirname, '../views/partials/footer.ejs'), 'utf8');
  assert.match(template, /home-feature-split/);
  assert.match(template, /The latest from the parks/);
  assert.match(template, /All theme park news/);
  assert.match(template, /home-plan-bar/);
  assert.match(template, /Stay connected/);
  assert.match(template, /Follow Florida Buzz/);
  assert.match(template, /Explore more of Florida/);
  assert.match(template, /id="newsletter"/);
  assert.match(template, /hideFooterNewsletter:\s*true/);
  assert.match(template, /tickerItems:\s*\[\]/);
  assert.match(footer, /hideFooterNewsletter/);
  assert.match(header, /nav-link-emphasis/);
  assert.match(header, /Theme Parks/);
  assert.match(header, /Explore Florida/);
  const primaryNav = header.split('nav-links-primary')[1].split('nav-search')[0];
  assert.match(primaryNav, /Merch/);
  assert.match(primaryNav, /Sponsorships/);
  assert.match(primaryNav, /href="\/merch"/);
  assert.match(primaryNav, /href="\/sponsors"/);
  const themeIdx = primaryNav.indexOf('Theme Parks');
  const guidesIdx = primaryNav.indexOf('Guides');
  const podcastsIdx = primaryNav.indexOf('Podcasts');
  const exploreIdx = primaryNav.indexOf('Explore Florida');
  const merchIdx = primaryNav.indexOf('Merch');
  const sponsorshipsIdx = primaryNav.indexOf('Sponsorships');
  assert.ok(themeIdx < guidesIdx && guidesIdx < podcastsIdx && podcastsIdx < exploreIdx);
  assert.ok(exploreIdx < merchIdx && merchIdx < sponsorshipsIdx);
  assert.match(header, /mobile-menu[\s\S]*Merch[\s\S]*Sponsorships/);
});

test('homepage renders featured lead photo above the headline', () => {
  const template = fs.readFileSync(path.join(__dirname, '../views/home.ejs'), 'utf8');
  const formatPubDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
  };
  const html = ejs.render(
    template,
    {
      featuredLead: story({ slug: 'lead', title: 'Lead Park Story', published_at: '2026-11-07T15:00:00Z' }),
      featuredSide: [
        story({ slug: 'side-1', title: 'Side One', published_at: '2026-11-06T15:00:00Z' }),
        story({ slug: 'side-2', title: 'Side Two', published_at: null }),
      ],
      moreThemeParks: [story({ slug: 'more-1', title: 'More One', published_at: '2026-11-05T15:00:00Z' })],
      aroundFlorida: {
        beaches: [story({ slug: 'beach-1', title: 'Quiet Beach', category: 'beaches' })],
      },
      exploreTiles: [{
        category: 'beaches',
        label: 'Beaches',
        href: '/category/beaches',
        image_url: IMG,
        image_alt: 'Beaches: Quiet Beach',
      }],
      guides: [],
      tools: [],
      planningOffers: [],
      undercoverTouristUrl: '',
      podcastShow: null,
      podcastLatest: null,
      podcastRecent: [],
      podcastPlatformLinks: [],
      socialProfiles: [
        { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/thefloridabuzz' },
        { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/floridabuzzonline/' },
        { id: 'threads', label: 'Threads', href: 'https://www.threads.net/@floridabuzzonline' },
        { id: 'pinterest', label: 'Pinterest', href: 'https://www.pinterest.com/floridabuzzonline/' },
        { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/@TheFloridaBuzz' },
      ],
      categoryLabels: {
        'theme-parks': 'Theme Parks',
        beaches: 'Beaches',
      },
      placeholderImg: () => '/images/article-placeholder-v1.svg',
      thumbUrl: (url) => url,
      timeAgo: () => '2h ago',
      formatPubDate,
      homePlaceTag,
      include: (name, locals = {}) => {
        if (name.includes('header')) return '<header></header>';
        if (name.includes('footer')) {
          return locals.hideFooterNewsletter ? '<footer data-no-newsletter="1"></footer>' : '<footer><div id="newsletter"></div></footer>';
        }
        if (name.includes('social-platform-icon')) {
          return `<svg data-platform="${locals.platformId || ''}"></svg>`;
        }
        return '';
      },
    },
    { filename: path.join(__dirname, '../views/home.ejs') }
  );

  assert.match(html, /home-feature-lead/);
  assert.match(html, /Lead Park Story/);
  assert.match(html, /href="\/article\/lead"/);
  assert.match(html, /href="\/wait-times"/);
  assert.match(html, /Explore more of Florida/);
  assert.match(html, /home-explore-tile/);
  assert.match(html, /home-social-follow/);
  assert.match(html, /Follow Florida Buzz/);
  assert.match(html, /facebook\.com\/thefloridabuzz/);
  assert.match(html, /youtube\.com\/@TheFloridaBuzz/);
  assert.match(html, /<time class="home-pub-date"/);
  assert.match(html, /Nov 7, 2026/);
  assert.match(html, /Nov 5, 2026/);
  assert.equal((html.match(/id="newsletter"/g) || []).length, 1);
  assert.match(html, /data-no-newsletter="1"/);
  const leadBlock = html.slice(html.indexOf('home-feature-lead'), html.indexOf('home-feature-side'));
  assert.ok(leadBlock.indexOf('<img') < leadBlock.indexOf('Lead Park Story'));
  const socialIdx = html.indexOf('home-social-follow');
  const exploreIdx = html.indexOf('home-explore');
  const moreIdx = html.indexOf('home-theme-more');
  assert.ok(moreIdx > -1 && socialIdx > moreIdx && exploreIdx > socialIdx);
});
