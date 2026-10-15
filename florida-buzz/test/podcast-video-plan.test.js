'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScenePlan, parseMarkedSegments, splitNamedOpen } = require('../lib/podcasts/videoPlan');

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
  assert.equal(plan.scenes.some((scene) => scene.kind === 'agenda'), true);
});
