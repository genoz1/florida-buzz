'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDigestHtml,
  buildDigestSubject,
  normalizeDigestInput,
  isStrongDisney,
  emailImageUrl,
} = require('../scripts/newsletter');

test('normalizeDigestInput keeps array compatibility and prefers park stories', () => {
  const digest = normalizeDigestInput([
    { slug: 'beach-day', title: 'Beach day', dek: 'Sun', category: 'beaches' },
    { slug: 'tron-price', title: 'Disney World Lightning Lane hits $25', dek: 'TRON', category: 'theme-parks', image_url: 'https://cdn.example/tron.jpg' },
    { slug: 'space-x', title: 'SpaceX launch', dek: 'Cape', category: 'space' },
  ]);
  assert.equal(digest.hero.slug, 'tron-price');
  assert.ok(digest.moreNews.some((a) => a.slug === 'beach-day' || a.slug === 'space-x'));
});

test('buildDigestHtml includes hero photo, tip, tools, and Disney framing', () => {
  const html = buildDigestHtml(
    {
      hero: {
        slug: 'disney-ll',
        title: 'Disney World Lightning Lane update',
        dek: 'Prices moved again.',
        category: 'theme-parks',
        image_url: 'https://cdn.example/ll.jpg',
      },
      disneyNews: [
        {
          slug: 'epcot-festival',
          title: 'EPCOT festival food booths',
          dek: 'New bites.',
          category: 'theme-parks',
        },
      ],
      tipGuide: {
        slug: 'best-hotels-near-disney-world-orlando',
        title: 'Best Hotels Near Disney World',
        dek: 'How to choose without overpaying.',
        category: 'theme-parks',
        image_url: 'https://cdn.example/hotel.jpg',
      },
      moreNews: [
        {
          slug: 'space-story',
          title: 'Cape Canaveral update',
          dek: 'Launch window.',
          category: 'space',
        },
      ],
      tools: [
        { id: 'wait-times', label: 'Live wait times', url: 'https://thefloridabuzz.com/wait-times', blurb: 'Parks' },
      ],
    },
    'https://thefloridabuzz.com/unsubscribe?email=a%40b.com',
    {}
  );

  assert.match(html, /Disney planning tips/i);
  assert.match(html, /Disney &amp; parks today|Disney & parks today/);
  assert.match(html, /cdn\.example\/ll-thumb\.jpg/);
  assert.match(html, /Disney tip of the day/);
  assert.match(html, /best-hotels-near-disney-world-orlando/);
  assert.match(html, /Live wait times/);
  assert.match(html, /Also in Florida/);
  assert.match(html, /Plan the trip with free tools|Hotels\.com|Undercover Tourist|commission/i);
  assert.match(html, /Unsubscribe/);
});

test('buildDigestSubject leads with Disney Buzz hero title', () => {
  const subject = buildDigestSubject({
    hero: { title: 'Disney World Lightning Lane hits record prices' },
  });
  assert.match(subject, /^Disney Buzz:/);
  assert.match(subject, /Lightning Lane/i);
});

test('isStrongDisney and emailImageUrl helpers', () => {
  assert.equal(isStrongDisney({ title: 'Universal Epic Universe hotel tip', category: 'theme-parks' }), false);
  assert.equal(isStrongDisney({ title: 'Magic Kingdom parade returns', category: 'theme-parks' }), true);
  assert.equal(
    emailImageUrl({ image_url: 'https://x.com/a/photo.jpg' }),
    'https://x.com/a/photo-thumb.jpg'
  );
});
