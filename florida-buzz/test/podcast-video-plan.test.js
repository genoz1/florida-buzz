'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScenePlan, parseMarkedSegments, splitCaptionChunks, splitNamedOpen, stableVisualKey } = require('../lib/podcasts/videoPlan');
const { broadenVisualPrompt } = require('../lib/podcasts/videoVisuals');
const { fitCoverFrame, renderTopicFrame, wrapWords } = require('../lib/podcasts/videoCards');

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

test('uses the cinematic editorial photo style for broaden prompts', () => {
  const { EDITORIAL_PHOTO_STYLE } = require('../lib/editorialPhotoStyle');
  assert.match(EDITORIAL_PHOTO_STYLE, /cinematic, photorealistic editorial travel photograph/i);
  assert.match(EDITORIAL_PHOTO_STYLE, /bright natural daylight|golden-hour/i);
  const room = broadenVisualPrompt('photoreal BoardWalk Inn guest room beds and furnishings', {
    label: 'Refreshed BoardWalk Inn Rooms',
    category: 'resort-room-refurbishment',
    level: 1,
  });
  assert.match(room, /cinematic, photorealistic editorial travel photograph/i);
  assert.match(room, /premium travel-magazine/i);
});

test('podcast video scenes stay stationary without zoompan drift', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.equal(/zoompan\s*=/.test(source), false);
  assert.match(source, /fps=30,fade=t=in/);
  assert.match(source, /fitCoverFrame/);
  assert.match(source, /renderTopicFrame/);
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

test('cover frame letterboxes square artwork instead of cropping the title', async () => {
  const { Jimp } = require('jimp');
  const square = new Jimp({ width: 800, height: 800, color: 0xff6452ff });
  const buffer = await square.getBuffer('image/png');
  const fitted = await fitCoverFrame(buffer);
  const frame = await Jimp.read(fitted);
  assert.equal(frame.width, 1920);
  assert.equal(frame.height, 1080);
  // Side pillar boxes stay black; center keeps artwork color.
  assert.equal(frame.getPixelColor(10, 540), 0x000000ff);
  assert.equal(frame.getPixelColor(960, 540), 0xff6452ff);
});

test('topic frames burn header, caption, and AI illustration label', async () => {
  const { Jimp } = require('jimp');
  const photo = new Jimp({ width: 1280, height: 720, color: 0x226688ff });
  const framed = await renderTopicFrame(await photo.getBuffer('image/png'), {
    label: '$49 Nomad Lounge fall offer',
    description: 'Annual Passholder dining perk details',
    category: 'passholder-perks',
    caption: 'The Nomad Lounge deal is the one that stands out to me just because it is so specific.',
    aiLabel: true,
  });
  const image = await Jimp.read(framed);
  assert.equal(image.width, 1920);
  assert.equal(image.height, 1080);
  // Header plate and caption plate are dark overlays, not the photo teal.
  assert.notEqual(image.getPixelColor(80, 60), 0x226688ff);
  assert.notEqual(image.getPixelColor(960, 920), 0x226688ff);
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

test('pipeline does not fall back to episode cover art for failed topic stills', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  assert.match(source, /renderTopicCard/);
  assert.equal(/Using episode cover fallback/.test(source), false);
  assert.match(source, /still locked to this story/);
  assert.match(source, /ONE real, currently recognizable Walt Disney World place/);
  assert.match(source, /never combine multiple lands/);
});

test('broaden prompts forbid multi-land mashups', () => {
  const prompt = broadenVisualPrompt('busy Disney World construction overview', {
    label: 'Disney World 2027 project slate',
    category: 'resort-wide-development',
    level: 1,
  });
  assert.match(prompt, /one real place|never a mashup/i);
});
