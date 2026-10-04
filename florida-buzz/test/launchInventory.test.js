const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const candidates = JSON.parse(fs.readFileSync(path.join(root, 'content/buzz-board-launch-candidates.json'), 'utf8'));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'content/buzz-board-launch-inventory.json'), 'utf8'));
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261003233000_buzz_board_launch_inventory.sql'), 'utf8');
const review = fs.readFileSync(path.join(root, 'content/BUZZ_BOARD_LAUNCH_REVIEW.md'), 'utf8');

test('launch candidates and selected inventory have the exact approved category distributions', () => {
  assert.equal(candidates.candidates.length, 60);
  assert.deepEqual(inventory.candidateDistribution, { disney: 30, universal: 17, cruises: 7, 'florida-life': 6 });
  assert.equal(inventory.discussions.length, 36);
  assert.deepEqual(inventory.selectedDistribution, { disney: 18, universal: 10, cruises: 4, 'florida-life': 4 });
});

test('launch inventory has unique stable metadata and diverse structures', () => {
  const slugs = inventory.discussions.map((item) => item.slug);
  const questions = inventory.discussions.map((item) => item.question.toLocaleLowerCase('en-US'));
  assert.equal(new Set(slugs).size, 36);
  assert.equal(new Set(questions).size, 36);
  assert.ok(Object.keys(inventory.structureStarts).length >= 10);
  assert.ok(Math.max(...Object.values(inventory.structureStarts)) <= 12);
  assert.ok(inventory.closestSemanticPairs.every((pair) => pair.similarity < 0.58));
  assert.ok(inventory.discussions.every((item) => item.score >= 48 && item.topic.length <= 80));
});

test('launch migration uses the active admin invariant and inserts no fake engagement', () => {
  assert.match(migration, /where role = 'admin' and status = 'active'/);
  assert.match(migration, /'florida_buzz', 'published', 'published', v_admin_id, 'Florida Buzz'/);
  assert.doesNotMatch(migration, /insert into public\.(?:responses|community_reactions|community_reports|discussion_impressions|profiles)/i);
  const insertColumns = migration.match(/insert into public\.discussions \(([\s\S]*?)\)\s*select/i)?.[1] || '';
  assert.doesNotMatch(insertColumns, /response_count|reaction_count|unique_participant_count|last_activity_at|created_at/i);
  assert.equal((migration.match(/^    \('/gm) || []).length, 36);
});

test('future member discussion path is documented but remains disabled', () => {
  assert.match(review, /No Phase 4 behavior enables member-created discussions/);
  assert.match(review, /source_type = 'member'/);
  assert.match(review, /status = 'draft'/);
  assert.match(review, /Deferring that additive enum\/check\s+change/);
  assert.doesNotMatch(migration, /'member'/);
});

test('the launch feed exposes the full 36-question inventory', () => {
  const router = fs.readFileSync(path.join(root, 'lib/community/router.js'), 'utf8');
  assert.match(router, /store\.listFeed\(filter, 50, 0\)/);
});

test('zero-response launch discussions are labeled as posted, not active', () => {
  for (const view of ['views/buzz.ejs', 'views/buzz-discussion.ejs']) {
    const template = fs.readFileSync(path.join(root, view), 'utf8');
    assert.match(template, /response_count\) === 0 \? 'Posted' : 'Active'/);
  }
});
