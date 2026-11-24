'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildPlaceSearchQuery,
  extractPlaceFromDirection,
  extractSpecificSubject,
  findPlaceReferencePhoto,
  licenseLooksOk,
  looksLikePeoplePrimaryText,
  overlapScore,
  placeSearchFallbacks,
  referenceMatchesSubject,
  withReferencePrompt,
  referenceReviewQuestion,
} = require('../lib/podcasts/placeReferencePhoto');
const { buildSpecificSubjectPrompt } = require('../lib/podcasts/videoVisuals');

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
  assert.match(once, /PHOTOREALISTIC|photorealistic/i);
  assert.match(once, /tight|SAME primary subject/i);
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
  assert.match(withRef, /photorealistic/i);
  const asIs = referenceReviewQuestion({
    label: 'BoardWalk',
    reference: { source: 'florida_buzz_article', title: 'BoardWalk Inn', useAsIs: true },
  });
  assert.match(asIs, /as-is/i);
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

test('gingerbread giraffe direction keeps specific subject — not park exterior or Main Street', () => {
  const direction =
    'Use a photorealistic, neutrally graded image of the gingerbread giraffe display at its actual Walt Disney World resort location.';
  assert.match(extractSpecificSubject(direction), /gingerbread/i);
  assert.match(extractPlaceFromDirection(direction), /gingerbread/i);
  assert.equal(/park exterior/i.test(extractPlaceFromDirection(direction)), false);

  const query = buildPlaceSearchQuery({
    label: 'Gingerbread Giraffe Returns',
    prompt: 'real photo of magic kingdoms decorated for Christmas. must include disney decorations',
    direction,
  });
  assert.match(query, /gingerbread/i);
  assert.equal(/\bentrance railroad station\b/i.test(query), false);

  const fallbacks = placeSearchFallbacks({
    label: 'Gingerbread Giraffe Returns',
    prompt: 'magic kingdom christmas',
    direction,
    primaryQuery: query,
  });
  assert.ok(fallbacks.some((q) => /gingerbread/i.test(q)));
  assert.equal(fallbacks.some((q) => /Main Street USA Magic Kingdom/i.test(q)), false);
  assert.equal(fallbacks.some((q) => /Cinderella Castle/i.test(q)), false);

  assert.equal(
    referenceMatchesSubject(
      {
        title: 'File:Walt Disney World Railroad Main Street USA Station 01.jpg',
        query: 'Magic Kingdom Main Street Walt Disney World',
        credit: 'Tom Arthur; CC BY-SA 2.0; via Wikimedia Commons',
      },
      { label: 'Gingerbread Giraffe Returns', direction }
    ),
    false
  );

  const specificPrompt = buildSpecificSubjectPrompt({
    label: 'Gingerbread Giraffe Returns',
    direction,
  });
  assert.match(specificPrompt, /gingerbread giraffe/i);
  assert.match(specificPrompt, /Do NOT show Cinderella Castle|Main Street railroad/i);

  const weakChristmas = buildSpecificSubjectPrompt({
    label: 'Gingerbread Giraffe Returns',
    direction: 'real photo of magic kingdoms decorated for Christmas. must include disney decorations',
  });
  assert.match(weakChristmas, /Gingerbread Giraffe|gingerbread/i);
  assert.equal(/exactly this subject: real photo of magic kingdoms/i.test(weakChristmas), false);
});

test('generic christmas magic kingdom direction still searchable but label-specific subject wins', () => {
  const query = buildPlaceSearchQuery({
    label: 'Gingerbread Giraffe Returns',
    prompt: 'real photo of magic kingdoms decorated for Christmas. must include disney decorations',
  });
  assert.match(query, /Gingerbread Giraffe|gingerbread/i);
});

test('Remy ride props reject Spaceship Earth; Dining Plan rejects Main Street station', () => {
  assert.match(extractSpecificSubject('Remy Ride Props Updated'), /Remy|Ratatouille/i);
  assert.match(extractSpecificSubject('Dining Plan Offer Changes'), /Dining Plan/i);

  assert.equal(
    referenceMatchesSubject(
      {
        title: 'File:Spaceship Earth, Epcot en janvier 2022 (4).jpg',
        query: 'EPCOT Spaceship Earth',
        credit: 'via Wikimedia Commons',
      },
      { label: 'Remy Ride Props Updated', prompt: 'France pavilion queue props' }
    ),
    false
  );

  assert.equal(
    referenceMatchesSubject(
      {
        title: 'File:Walt Disney World Railroad Main Street USA Station 01.jpg',
        query: 'Magic Kingdom Main Street',
        credit: 'Tom Arthur; CC BY-SA 2.0; via Wikimedia Commons',
      },
      { label: 'Dining Plan Offer Changes', prompt: 'Disney Dining Plan changes' }
    ),
    false
  );

  const remyQuery = buildPlaceSearchQuery({
    label: 'Remy Ride Props Updated',
    prompt: 'updated Remy queue props in France pavilion',
  });
  assert.match(remyQuery, /Remy|Ratatouille|France/i);
  assert.equal(/\bSpaceship Earth\b/i.test(remyQuery), false);

  const diningQuery = buildPlaceSearchQuery({
    label: 'Dining Plan Offer Changes',
    prompt: 'Disney Dining Plan offer updates',
  });
  assert.match(diningQuery, /Dining Plan/i);
  assert.equal(/\bentrance railroad station\b/i.test(diningQuery), false);
});

test('video pipeline requires verified v6 article-first stills and blocks incomplete publish', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.match(source, /youtube-visuals\/v6\//);
  assert.match(source, /findPlaceReferencePhoto/);
  assert.match(source, /editImageFromReference/);
  assert.match(source, /tryGenerateSpecificSubjectStill|ai_specific_subject/);
  assert.match(source, /forceGenerateSubjectStill|mustProduce|ai_specific_subject_forced/);
  assert.match(source, /buildSpecificSubjectPrompt/);
  assert.match(source, /article_ai_as_is|useAsIs/);
  assert.match(source, /PODCAST_YOUTUBE_PHOTOREAL_STYLE/);
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

test('photoreal YouTube style forbids yellow wash; legacy illustration kept', () => {
  const {
    PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
    PODCAST_YOUTUBE_PHOTOREAL_STYLE,
  } = require('../lib/editorialPhotoStyle');
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /Mandalorian/i);
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /FORBIDDEN: yellow|NO yellow|avoid heavy yellow/i);
  assert.match(PODCAST_YOUTUBE_PHOTOREAL_STYLE, /photorealistic/i);
  assert.match(PODCAST_YOUTUBE_PHOTOREAL_STYLE, /Tight subject lock/i);
  assert.match(PODCAST_YOUTUBE_PHOTOREAL_STYLE, /FORBIDDEN: yellow|NO yellow/i);
  const { PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS } = require('../lib/podcasts/videoVisuals');
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /yellow\/amber\/sepia|Yellow\/golden-hour/i);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /photorealistic/i);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /unknown people|panel guests|two random people/i);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /railroad bridge/i);
});

test('placeReferencePhoto prefers article heroes before Wikimedia', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/placeReferencePhoto.js'), 'utf8');
  const fnStart = source.indexOf('async function findPlaceReferencePhoto');
  assert.ok(fnStart > 0);
  const body = source.slice(fnStart, fnStart + 2500);
  const articleIdx = body.indexOf('findArticleHeroReference({');
  const wikiIdx = body.indexOf('searchWikimediaPlacePhoto');
  assert.ok(articleIdx > 0 && wikiIdx > articleIdx, 'article lookup should run before Wikimedia search in findPlaceReferencePhoto');
  assert.match(source, /useAsIs/);
  assert.match(source, /articleImageOrigin/);
  assert.match(source, /looksLikePeoplePrimaryText/);
});
