'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScenePlan, parseMarkedSegments, splitCaptionChunks, splitNamedOpen, stableVisualKey } = require('../lib/podcasts/videoPlan');
const {
  broadenVisualPrompt,
  hardenPlacePrompt,
  placeAccuracyRules,
  PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS,
} = require('../lib/podcasts/videoVisuals');
const { fitCoverFrame, renderTopicFrame, wrapWords } = require('../lib/podcasts/videoCards');
const { parseJsonObject, resolveVideoTotalSeconds } = require('../lib/podcasts/videoPipeline');

const SCRIPT = `=== SEGMENT: open ===
Geno: Welcome to the Florida Buzz Disney podcast. I'm your host Geno, and thank you for joining us. Here's what's happening at Disney World. Let's go.
Geno: Today we're talking about a new meet-and-greet, a lounge perk, and several park updates.
=== SEGMENT: story-1 ===
Geno: The Mandalorian and Grogu meet-and-greet is the first story today. Here is what Disney announced.
=== SEGMENT: story-2 ===
Geno: The Nomad Lounge update changes a dining perk for passholders.
=== SEGMENT: midroll ===
Geno: Florida Buzz partners with Undercover Tourist.
=== SEGMENT: close ===
Geno: Thanks for listening to the Florida Buzz Disney podcast.`;

test('parses structural podcast markers without speaking them', () => {
  const segments = parseMarkedSegments(SCRIPT);
  assert.deepEqual(segments.map((segment) => segment.slug), ['open', 'story-1', 'story-2', 'midroll', 'close']);
  assert.equal(segments.some((segment) => segment.text.includes('SEGMENT:')), false);
});

test('keeps the cover through Lets go and uses an agenda afterward', () => {
  const open = parseMarkedSegments(SCRIPT)[0];
  const split = splitNamedOpen(open);
  assert.match(split.introText, /Let's go/i);
  assert.match(split.agendaText, /Today we're talking/i);
});

test('limits story visuals to two reusable images by default', () => {
  const plan = buildScenePlan({
    scriptText: SCRIPT,
    totalSeconds: 720,
    bumperSeconds: 8.3,
    topicMeta: [
      { slug: 'story-1', title: 'Mandalorian and Grogu', category: 'character-meet-and-greets', prompts: ['a', 'b', 'c'] },
      { slug: 'story-2', title: 'Nomad Lounge Perk', category: 'dining', prompts: ['d', 'e', 'f'] },
    ],
  });
  assert.equal(plan.scenes.filter((scene) => scene.segmentSlug === 'story-1').length, 2);
  assert.equal(plan.scenes.filter((scene) => scene.segmentSlug === 'story-2').length, 2);
  assert.equal(plan.scenes[0].kind, 'cover');
  assert.equal(plan.scenes.filter((scene) => scene.kind === 'cover').length, 1);
  assert.ok(plan.scenes[0].durationSeconds > 8.3);
  assert.equal(plan.scenes.some((scene) => scene.kind === 'agenda'), true);
});

test('uses the painterly podcast YouTube illustration style for broaden prompts', () => {
  const { PODCAST_YOUTUBE_ILLUSTRATION_STYLE } = require('../lib/editorialPhotoStyle');
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /digital travel illustration/i);
  assert.match(PODCAST_YOUTUBE_ILLUSTRATION_STYLE, /painterly/i);
  const room = broadenVisualPrompt('photoreal BoardWalk Inn guest room beds and furnishings', {
    label: 'Refreshed BoardWalk Inn Rooms',
    category: 'resort-room-refurbishment',
    level: 1,
  });
  assert.match(room, /digital travel illustration/i);
  assert.match(room, /painterly/i);
});

test('topic stills use 2x work-res continuous pan; no zoompan breathing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.equal(/zoompan\s*=/.test(source), false);
  assert.match(source, /topicMotionFilter/);
  assert.match(source, /workW = 3840|scale=3840:2160/);
  assert.match(source, /flags=bilinear/);
  assert.match(source, /panSeconds/);
  assert.match(source, /overscan/);
  assert.match(source, /preset', 'ultrafast'|preset', \"ultrafast\"/);
  assert.match(source, /Rendering YouTube clip/);
  assert.match(source, /stationaryFilter/);
  assert.match(source, /fps=30,fade=t=in/);
  assert.match(source, /fitCoverFrame/);
  assert.match(source, /renderTopicBackground/);
  assert.match(source, /renderTopicOverlay/);
  assert.match(source, /topicMotionOverlayFilter/);
  assert.match(source, /probeMp3DurationSec/);
  assert.match(source, /resolveVideoTotalSeconds/);
});

test('topicMotionFilter emits a fast 2x pan filter and caps long pans', () => {
  const { topicMotionFilter, topicMotionOverlayFilter } = require('../lib/podcasts/videoPipeline');
  const short = topicMotionFilter({ durationSeconds: 8, sceneIndex: 0 });
  assert.match(short, /scale=3840:2160:flags=bilinear/);
  assert.match(short, /scale=1920:1080:flags=bilinear/);
  assert.match(short, /min\(1\\,t\/8\.000\)/);
  assert.equal(/zoompan/.test(short), false);
  const long = topicMotionFilter({ durationSeconds: 90, sceneIndex: 1 });
  assert.match(long, /min\(1\\,t\/24\.000\)/);
  assert.equal(/t\/90/.test(long), false);
  const overlay = topicMotionOverlayFilter({ durationSeconds: 12, sceneIndex: 0 });
  assert.match(overlay, /\[0:v\].*\[bg\]/);
  assert.match(overlay, /\[bg\]\[1:v\]overlay=0:0/);
});

test('topic overlay chrome is separate from the panned photo', async () => {
  const { Jimp } = require('jimp');
  const {
    renderTopicBackground,
    renderTopicOverlay,
    renderTopicFrame,
  } = require('../lib/podcasts/videoCards');
  const photo = new Jimp({ width: 1600, height: 900, color: 0x336699ff });
  const buf = await photo.getBuffer('image/png');
  const bg = await Jimp.read(await renderTopicBackground(buf));
  const overlay = await Jimp.read(
    await renderTopicOverlay({ label: 'Main Street USA', category: 'theme-parks', caption: 'Park update' })
  );
  // Background has no navy header plate; overlay does (top-left).
  const bgPixel = bg.getPixelColor(80, 60);
  const overlayPixel = overlay.getPixelColor(80, 60);
  assert.notEqual(bgPixel, overlayPixel);
  assert.equal(overlay.getPixelColor(1900, 1000) >>> 0 & 0xff, 0); // transparent corner
  const framed = await Jimp.read(
    await renderTopicFrame(buf, { label: 'Main Street USA', category: 'theme-parks' })
  );
  assert.equal(framed.bitmap.width, 1920);
  assert.equal(framed.bitmap.height, 1080);
});

test('YouTube scene timing uses probed audio when episode duration is missing', () => {
  assert.equal(resolveVideoTotalSeconds(null, 811.65), 811.65);
  assert.equal(resolveVideoTotalSeconds(0, 811.65), 811.65);
  assert.equal(resolveVideoTotalSeconds(12, 811.65), 811.65);
  assert.equal(resolveVideoTotalSeconds(800, 811.65), 800);
  assert.throws(() => resolveVideoTotalSeconds(null, 10), /usable audio duration/i);
  const collapsed = buildScenePlan({ scriptText: SCRIPT, totalSeconds: null, bumperSeconds: 8.3 });
  const synced = buildScenePlan({ scriptText: SCRIPT, totalSeconds: 720, bumperSeconds: 8.3 });
  const sum = (plan) => plan.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  assert.ok(sum(collapsed) < 30, 'null duration must not be treated as a full episode');
  assert.ok(Math.abs(sum(synced) - 720) < 0.01);
});

test('topic scenes carry short burned-in caption chunks', () => {
  const plan = buildScenePlan({
    scriptText: SCRIPT,
    totalSeconds: 720,
    topicMeta: [
      { slug: 'story-2', title: 'Nomad Lounge Perk', category: 'passholder-perks', prompts: ['a', 'b'] },
    ],
  });
  const captions = plan.scenes.filter((scene) => scene.segmentSlug === 'story-2').map((scene) => scene.caption);
  assert.equal(captions.length, 2);
  assert.ok(captions.every((caption) => String(caption || '').trim().length > 0));
  assert.match(captions.join(' '), /Nomad Lounge/i);
  assert.deepEqual(splitCaptionChunks('one two three four five six', 2).map((part) => part.split(/\s+/).length), [3, 3]);
  assert.deepEqual(wrapWords('The Nomad Lounge deal is the one that stands out to me just because it is so specific.', 44, 2).length, 2);
});

test('cover frame keeps full square artwork over a blurred fill', async () => {
  const { Jimp } = require('jimp');
  const square = new Jimp({ width: 800, height: 800, color: 0xff6452ff });
  const buffer = await square.getBuffer('image/png');
  const fitted = await fitCoverFrame(buffer, { caption: '' });
  const frame = await Jimp.read(fitted);
  assert.equal(frame.width, 1920);
  assert.equal(frame.height, 1080);
  // Center keeps artwork color; sides are a darkened blurred fill (not flat black).
  assert.equal(frame.getPixelColor(960, 540), 0xff6452ff);
  assert.notEqual(frame.getPixelColor(10, 540), 0x000000ff);
});

test('topic frames burn header and caption without AI illustration badge', async () => {
  const { Jimp } = require('jimp');
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoCards.js'), 'utf8');
  assert.match(source, /AI badge intentionally omitted/);
  const photo = new Jimp({ width: 1280, height: 720, color: 0x226688ff });
  const framed = await renderTopicFrame(await photo.getBuffer('image/png'), {
    label: '$49 Nomad Lounge fall offer',
    category: 'passholder-perks',
    caption: 'The Nomad Lounge deal is the one that stands out to me just because it is so specific.',
  });
  const image = await Jimp.read(framed);
  assert.equal(image.width, 1920);
  assert.equal(image.height, 1080);
  // Header plate is a dark overlay, not the photo teal.
  assert.notEqual(image.getPixelColor(80, 60), 0x226688ff);
});

test('agenda card matches the first-episode menu layout', async () => {
  const { Jimp } = require('jimp');
  const { renderAgendaCard, shortAgendaBlurb } = require('../lib/podcasts/videoCards');
  assert.equal(shortAgendaBlurb('Higher Single Pass ceilings for major headliners'), 'Higher Single Pass ceilings');
  assert.ok(shortAgendaBlurb('Higher Single Pass ceilings for major headliners').length <= 32);
  assert.ok(shortAgendaBlurb('A new park specific collectible joins the retail mix').split(/\s+/).length <= 5);
  assert.equal(shortAgendaBlurb('Set element installation points to tangible progress'), 'Set element installation points');
  assert.doesNotMatch(shortAgendaBlurb('Savannah Bananas tournament dates spark trip'), /\b(for|to|the|a|of)\s*$/i);
  const cover = new Jimp({ width: 800, height: 800, color: 0xff6452ff });
  const buffer = await renderAgendaCard({
    coverBuffer: await cover.getBuffer('image/png'),
    topics: [
      { title: 'Lightning Lane Price Hike', description: 'Higher Single Pass ceilings for major headliners' },
      { title: 'Nomad Lounge', description: 'Reservations and Annual Passholder perks' },
    ],
    footer: 'FLORIDA BUZZ: DISNEY • OCTOBER 14, 2026',
  });
  const image = await Jimp.read(buffer);
  assert.equal(image.width, 1920);
  assert.equal(image.height, 1080);
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoCards.js'), 'utf8');
  assert.match(source, /TODAY'S DISNEY WORLD ROUNDUP/);
  assert.match(source, /What's in this episode/);
  assert.match(source, /shortAgendaBlurb/);
  const planner = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.match(planner, /max 5 words, under 32 characters/);
});

test('visual keys stay stable when AI prompt wording changes', () => {
  const a = buildScenePlan({
    scriptText: SCRIPT,
    totalSeconds: 720,
    episodeId: 'ep-1',
    topicMeta: [{ slug: 'story-1', title: 'Mandalorian', category: 'meets', prompts: ['prompt one', 'prompt two'] }],
  });
  const b = buildScenePlan({
    scriptText: SCRIPT,
    totalSeconds: 720,
    episodeId: 'ep-1',
    topicMeta: [{ slug: 'story-1', title: 'Mandalorian', category: 'meets', prompts: ['totally different wording', 'another wording'] }],
  });
  const keysA = a.scenes.filter((scene) => scene.segmentSlug === 'story-1').map((scene) => scene.visualKey);
  const keysB = b.scenes.filter((scene) => scene.segmentSlug === 'story-1').map((scene) => scene.visualKey);
  assert.deepEqual(keysA, keysB);
  assert.equal(stableVisualKey({ episodeId: 'ep-1', segmentSlug: 'story-1', index: 0 }), keysA[0]);
});

test('broadens specific interiors to related exteriors of the same subject', () => {
  const room = broadenVisualPrompt('photoreal BoardWalk Inn guest room beds and furnishings', {
    label: 'Refreshed BoardWalk Inn Rooms',
    category: 'resort-room-refurbishment',
    level: 1,
  });
  assert.match(room, /exterior/i);
  assert.match(room, /BoardWalk Inn/i);
  assert.match(room, /hotel|resort/i);
  assert.match(room, /Do not show Cinderella Castle/i);
  assert.match(room, /BoardWalk Inn Rooms|BoardWalk Inn/i);
  assert.doesNotMatch(room, /guest room beds and furnishings/i);

  const roomWide = broadenVisualPrompt('photoreal BoardWalk Inn guest room beds and furnishings', {
    label: 'Refreshed BoardWalk Inn Rooms',
    level: 2,
  });
  assert.match(roomWide, /BoardWalk Inn/i);
  assert.match(roomWide, /Do not show Cinderella Castle/i);
  assert.match(roomWide, /resort hotel facade|entrance area|specific property/i);

  const ride = broadenVisualPrompt('inside Space Mountain ride vehicle in the dark', {
    label: 'Space Mountain',
    category: 'attractions',
    level: 1,
  });
  assert.match(ride, /exterior/i);
  assert.match(ride, /Space Mountain/i);
  assert.match(ride, /Do not show Cinderella Castle/i);
});

test('pipeline gates YouTube publish on verified place-photo stills', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.equal(/Using episode cover fallback/.test(source), false);
  assert.equal(/Using story title card/.test(source), false);
  assert.match(source, /prepareAllTopicStills/);
  assert.match(source, /buildVerifiedTopicStill/);
  assert.match(source, /STILLS_INCOMPLETE/);
  assert.match(source, /stills_incomplete/);
  assert.match(source, /youtube-visuals\/v5\//);
  assert.match(source, /findPlaceReferencePhoto/);
  assert.match(source, /editImageFromReference/);
  assert.match(source, /maxAttempts:\s*1/);
  assert.match(source, /applyStillColorFix/);
  assert.match(source, /coolYellowCast/);
  assert.match(source, /story stills verified/);
  assert.match(source, /hardenPlacePrompt/);
  assert.match(source, /PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS/);
  assert.match(source, /Continuing YouTube render with default story titles/);
});

test('broaden prompts forbid multi-land mashups', () => {
  const prompt = broadenVisualPrompt('busy Disney World construction overview', {
    label: 'Disney World 2027 project slate',
    category: 'resort-wide-development',
    level: 1,
  });
  assert.match(prompt, /one real place|never a mashup/i);
});

test('place accuracy locks BoardWalk, runDisney, Contemporary monorail, and MK mashups', () => {
  const boardwalk = placeAccuracyRules('Wine & Dine road closures near BoardWalk');
  assert.ok(boardwalk.some((rule) => /pedestrian boardwalk/i.test(rule)));
  assert.ok(boardwalk.some((rule) => /No cars, buses/i.test(rule)));
  assert.ok(boardwalk.some((rule) => /runDisney|park paths/i.test(rule)));

  const contemporary = hardenPlacePrompt('Luggage carts outside Contemporary Resort with monorail', {
    label: 'Resort Bell Services Cold Grocery Transfers',
    category: 'resort-services',
  });
  assert.match(contemporary, /Place accuracy locks:/i);
  assert.match(contemporary, /THROUGH the A-frame/i);
  assert.match(contemporary, /around the hotel|wrapped around the exterior/i);

  const runners = broadenVisualPrompt('runners waiting beside a transit bus at BoardWalk', {
    label: 'runDisney Wine & Dine Road Closures',
    category: 'rundisney-events',
    level: 1,
  });
  assert.match(runners, /park paths|race course/i);
  assert.match(runners, /Do not show runners in automotive traffic|not car lanes beside buses/i);
  assert.match(runners, /Mandalorian|FORBIDDEN: yellow/i);

  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /BoardWalk/);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /Contemporary monorail/);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /car lanes beside buses/);
  assert.match(PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS, /railroad bridge/);
});

test('youtube retry regenerates stills for review; video needs approved board', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../lib/podcasts/routerAdmin.js'), 'utf8');
  const auto = fs.readFileSync(path.join(__dirname, '../lib/podcasts/autoPublish.js'), 'utf8');
  const pipeline = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.match(admin, /youtube-retry/);
  assert.match(admin, /youtube-stills-regenerate-queued/);
  assert.match(admin, /force:\s*true/);
  assert.match(auto, /force\s*=\s*false/);
  assert.match(auto, /queueStillsPrepare/);
  assert.match(pipeline, /stills_review_required/);
  assert.match(pipeline, /approvedStillsBoard/);
  assert.match(pipeline, /already_uploaded.*!force|!force[\s\S]*already_uploaded/);
  assert.match(pipeline, /deleteAssetByStoragePath/);
  assert.match(pipeline, /YouTube force rebuild/);
});

test('topic planner JSON parser tolerates trailing commas and newlines in strings', () => {
  const parsed = parseJsonObject(`{
    "topics": [
      {
        "slug": "story-1",
        "title": "Lightning Lane",
        "description": "Price hike details",
        "category": "genie-plus",
        "prompts": ["Wide view of
a queue exterior", "Closer pavilion exterior"],
      },
    ]
  }`);
  assert.equal(parsed.topics.length, 1);
  assert.match(parsed.topics[0].prompts[0], /Wide view of/);
});
