'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildPlaceSearchQuery,
  extractPlaceFromDirection,
  findPlaceReferencePhoto,
  licenseLooksOk,
  looksLikePeoplePrimaryText,
  overlapScore,
  withReferencePrompt,
  referenceReviewQuestion,
} = require('../lib/podcasts/placeReferencePhoto');

test('admin direction overrides Premier Pass entrance remap to Space Mountain', () => {
  assert.match(extractPlaceFromDirection('change to space mountain exterior'), /Space Mountain/i);
  const query = buildPlaceSearchQuery({
    label: '$499 Premier Pass',
    prompt: 'Magic Kingdom ticket gates',
    category: 'ticketing',
    direction: 'change to space mountain exterior',
  });
  assert.match(query, /Space Mountain/i);
  assert.equal(/\bentrance railroad station\b/i.test(query), false);
});

test('generic Disney Parks direction yields a searchable place for D23 failures', () => {
  const place = extractPlaceFromDirection('create a Photo realistic image from inside one of the Disney Parks');
  assert.match(place, /Walt Disney World|Magic Kingdom|Tomorrowland/i);
  const query = buildPlaceSearchQuery({
    label: 'D23 Gold Theater Panels',
    prompt: 'panel guests',
    direction: 'Photo realistic image from inside one of the Disney Parks',
  });
  assert.match(query, /Walt Disney World/i);
  assert.equal(/\bGold Theater Panels\b/i.test(query), false);
});

test('Main Street USA direction and bag-restriction labels resolve to searchable places', () => {
  assert.match(extractPlaceFromDirection('photo realistic image of main street usa'), /main street/i);
  const directed = buildPlaceSearchQuery({
    label: 'Park Bag Restrictions',
    prompt: 'security bag check',
    direction: 'photo realistic image of main street usa',
  });
  assert.match(directed, /main street/i);
  const bare = buildPlaceSearchQuery({
    label: 'Park Bag Restrictions',
    prompt: 'security bag check at the park',
  });
  assert.match(bare, /Main Street|Magic Kingdom|entrance/i);
});

test('buildPlaceSearchQuery keeps real place names for BoardWalk and Contemporary', () => {
  const boardwalk = buildPlaceSearchQuery({
    label: 'Wine & Dine Race Weekend',
    prompt: 'Runners on Disney BoardWalk wooden promenade',
    category: 'rundisney-events',
  });
  assert.match(boardwalk, /Board\s*-?\s*Walk/i);
  assert.match(boardwalk, /Walt Disney World/i);

  const contemporary = buildPlaceSearchQuery({
    label: 'Cold Grocery Transfers',
    prompt: 'Luggage carts at Contemporary Resort with monorail',
  });
  assert.match(contemporary, /Contemporary/i);
  assert.match(contemporary, /monorail/i);
});

test('licenseLooksOk accepts CC/public domain and rejects fair-use-only', () => {
  assert.equal(licenseLooksOk({ LicenseShortName: { value: 'CC BY 2.0' } }), true);
  assert.equal(licenseLooksOk({ LicenseShortName: { value: 'Public domain' } }), true);
  assert.equal(licenseLooksOk({ LicenseShortName: { value: 'Fair use' }, Permission: { value: 'All rights reserved' } }), false);
});

test('overlapScore ranks matching article titles above unrelated ones', () => {
  assert.ok(
    overlapScore('Holiday Spirit Jerseys', 'New Holiday Spirit Jerseys Arrive at Disney Springs')
      > overlapScore('Holiday Spirit Jerseys', 'Magic Kingdom Premier Pass Price')
  );
});

test('withReferencePrompt appends architecture lock once', () => {
  const once = withReferencePrompt('BoardWalk exterior', { buffer: Buffer.from('x') });
  assert.match(once, /Reference photograph lock/i);
  assert.match(once, /Preserve the real architecture/i);
  const twice = withReferencePrompt(once, { buffer: Buffer.from('x') });
  assert.equal(twice.split('Reference photograph lock:').length - 1, 1);
});

test('referenceReviewQuestion mentions reference source when present', () => {
  const withRef = referenceReviewQuestion({
    label: 'BoardWalk',
    reference: { source: 'wikimedia', title: 'File:Disney boardwalk.jpg' },
  });
  assert.match(withRef, /reference photo/i);
  assert.match(withRef, /wikimedia/i);
  const bare = referenceReviewQuestion({ label: 'BoardWalk' });
  assert.match(bare, /place-photo template|no yellow cast/i);
});

test('findPlaceReferencePhoto returns Wikimedia candidate via injected fetch', async () => {
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  // Pad so size check passes (>= 8KB)
  const photo = Buffer.concat([tinyPng, Buffer.alloc(9000, 1)]);
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('api.php')) {
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              1: {
                title: 'File:Disney BoardWalk Resort wooden promenade.jpg',
                imageinfo: [{
                  url: 'https://example.test/boardwalk.jpg',
                  thumburl: 'https://example.test/boardwalk.jpg',
                  mime: 'image/jpeg',
                  width: 1600,
                  height: 900,
                  size: 120000,
                  extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'Test Photographer' } },
                }],
              },
            },
          },
        }),
      };
    }
    return {
      ok: true,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
      arrayBuffer: async () => photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength),
    };
  };

  const ref = await findPlaceReferencePhoto({
    label: 'BoardWalk Inn',
    prompt: 'Disney BoardWalk wooden promenade by the water',
    fetchImpl,
  });
  assert.equal(ref.source, 'wikimedia');
  assert.match(ref.credit, /Test Photographer|CC BY 2.0|Wikimedia/i);
  assert.ok(Buffer.isBuffer(ref.buffer));
  assert.ok(ref.buffer.length >= 8000);
});

test('looksLikePeoplePrimaryText catches D23 panel / interview heroes', () => {
  assert.equal(looksLikePeoplePrimaryText('D23 Gold Theater Panels'), true);
  assert.equal(looksLikePeoplePrimaryText('Magic Kingdom entrance railroad station'), false);
});

test('premier pass query prefers Magic Kingdom entrance wording', () => {
  const q = buildPlaceSearchQuery({
    label: 'Magic Kingdom Premier Pass',
    prompt: 'ticketing machines and Lightning Lane',
    category: 'ticketing',
  });
  assert.match(q, /entrance|railroad/i);
});

test('video pipeline requires verified v5 stills and blocks incomplete publish', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.match(source, /youtube-visuals\/v5\//);
  assert.match(source, /findPlaceReferencePhoto/);
  assert.match(source, /editImageFromReference/);
  assert.match(source, /prepareAllTopicStills/);
  assert.match(source, /stills_incomplete/);
  assert.match(source, /withReferencePrompt/);
  assert.equal(/Using story title card/.test(source), false);
});

test('openai exports editImageFromReference', () => {
  const openai = require('../lib/openai');
  assert.equal(typeof openai.editImageFromReference, 'function');
  assert.equal(typeof openai.generateImage, 'function');
});

test('Mandalorian style forbids yellow wash', () => {
  const { PODCAST_YOUTUBE_ILLUSTRATION_STYLE } = require('../lib/editorialPhotoStyle');
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /Mandalorian/i);
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /FORBIDDEN: yellow|NO yellow|avoid heavy yellow/i);
  const { PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS } = require('../lib/podcasts/videoVisuals');
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /yellow\/amber\/sepia|Yellow\/golden-hour/i);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /unknown people|panel guests|two random people/i);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /railroad bridge/i);
});
