'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  stillKey,
  getStillsBoard,
  allStillsApproved,
  boardSummary,
  describeYoutubeProgress,
  createYoutubeStillsReview,
} = require('../lib/podcasts/youtubeStillsReview');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');

test('describeYoutubeProgress reports building and published phases', () => {
  const building = describeYoutubeProgress({
    status: 'published',
    outline_json: {
      youtube_stills: {
        status: 'building_video',
        items: [
          { status: 'approved', public_url: 'https://example.com/a.png' },
          { status: 'approved', public_url: 'https://example.com/b.png' },
        ],
      },
    },
  });
  assert.equal(building.state, 'live');
  assert.equal(building.phase, 'building_video');
  assert.ok(building.percent >= 80);

  const published = describeYoutubeProgress({
    status: 'published',
    outline_json: {
      youtube_stills: {
        status: 'video_published',
        youtube_url: 'https://youtu.be/test',
        items: [
          { status: 'approved', public_url: 'https://example.com/a.png' },
          { status: 'approved', public_url: 'https://example.com/b.png' },
        ],
      },
    },
  });
  assert.equal(published.state, 'done');
  assert.equal(published.percent, 100);
  assert.equal(published.youtube_url, 'https://youtu.be/test');
});

test('stillKey is stable per segment and image index', () => {
  assert.equal(stillKey('story-1', 0), 'story-1-0');
  assert.equal(stillKey('story-1', 1), 'story-1-1');
});

test('allStillsApproved requires every item approved with a URL', () => {
  assert.equal(allStillsApproved({ items: [] }), false);
  assert.equal(
    allStillsApproved({
      items: [
        { status: 'approved', public_url: 'https://example.com/a.png' },
        { status: 'ready', public_url: 'https://example.com/b.png' },
      ],
    }),
    false
  );
  assert.equal(
    allStillsApproved({
      items: [
        { status: 'approved', public_url: 'https://example.com/a.png' },
        { status: 'approved', public_url: 'https://example.com/b.png' },
      ],
    }),
    true
  );
});

test('boardSummary counts statuses', () => {
  const summary = boardSummary({
    items: [
      { status: 'approved' },
      { status: 'ready' },
      { status: 'failed' },
      { status: 'regenerating' },
    ],
  });
  assert.equal(summary.total, 4);
  assert.equal(summary.approved, 1);
  assert.equal(summary.ready, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.regenerating, 1);
  assert.equal(summary.allApproved, false);
});

test('createYoutubeStillsReview approve/reject/create gates video on approval', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Stills review episode',
    description: 'Test stills board',
    show_notes_html: '<p>notes</p>',
    slug: 'stills-review-episode',
  });
  await store.updateEpisode(episode.id, {
    status: 'published',
    audio_url: 'https://example.com/audio.mp3',
    outline_json: {
      youtube_stills: {
        status: 'ready_for_review',
        items: [
          {
            id: 'story-1-0',
            label: 'Main Street',
            public_url: 'https://example.com/a.png',
            status: 'ready',
          },
          {
            id: 'story-1-1',
            label: 'Castle',
            public_url: 'https://example.com/b.png',
            status: 'ready',
          },
        ],
      },
    },
  });

  let publishCalls = 0;
  let regenerateCalls = 0;
  const videoPipeline = {
    prepareStillsBoard: async () => ({
      items: [
        {
          id: 'story-1-0',
          label: 'Main Street',
          public_url: 'https://example.com/a.png',
          status: 'ready',
        },
      ],
      failedCount: 0,
    }),
    regenerateStillForReview: async (_ep, stillId, { direction }) => {
      regenerateCalls += 1;
      return {
        id: stillId,
        label: 'Main Street',
        public_url: 'https://example.com/a2.png',
        status: 'ready',
        rejection_note: direction,
      };
    },
    publishEpisode: async (_ep, opts) => {
      publishCalls += 1;
      assert.ok(opts.approvedStillsBoard);
      assert.equal(allStillsApproved(opts.approvedStillsBoard), true);
      return { id: 'yt-1', url: 'https://youtu.be/yt-1' };
    },
  };

  const review = createYoutubeStillsReview({
    store,
    cfg: { youtubeEnabled: true },
    videoPipeline,
  });

  let fresh = await store.getEpisodeById(episode.id);
  await assert.rejects(
    () => review.createVideoFromApprovedStills(fresh),
    /Approve every YouTube still/
  );
  assert.equal(publishCalls, 0);

  ({ episode: fresh } = await review.approveStill(fresh, 'story-1-0'));
  assert.equal(getStillsBoard(fresh).items.find((i) => i.id === 'story-1-0').status, 'approved');
  assert.equal(getStillsBoard(fresh).status, 'ready_for_review');

  ({ episode: fresh } = await review.rejectStill(fresh, 'story-1-1', 'cooler daylight, no people'));
  assert.equal(regenerateCalls, 1);
  assert.equal(getStillsBoard(fresh).items.find((i) => i.id === 'story-1-1').status, 'ready');
  assert.match(getStillsBoard(fresh).items.find((i) => i.id === 'story-1-1').rejection_note, /cooler daylight/);

  ({ episode: fresh } = await review.approveAllStills(fresh));
  assert.equal(getStillsBoard(fresh).status, 'approved');
  assert.equal(allStillsApproved(getStillsBoard(fresh)), true);

  const result = await review.createVideoFromApprovedStills(fresh);
  assert.equal(publishCalls, 1);
  assert.equal(result.url, 'https://youtu.be/yt-1');
  fresh = await store.getEpisodeById(episode.id);
  assert.equal(getStillsBoard(fresh).status, 'video_published');
  assert.equal(getStillsBoard(fresh).youtube_url, 'https://youtu.be/yt-1');
});

test('rejectStillsBulk regenerates multiple stills with shared direction', async () => {
  const store = createMemoryStore();
  const show = await store.getShow('florida-buzz-disney');
  const episode = await store.createEpisode(show.id, {
    title: 'Bulk stills episode',
    description: 'Test bulk reject',
    show_notes_html: '<p>notes</p>',
    slug: 'bulk-stills-episode',
  });
  await store.updateEpisode(episode.id, {
    status: 'published',
    audio_url: 'https://example.com/audio.mp3',
    outline_json: {
      youtube_stills: {
        status: 'ready_for_review',
        items: [
          {
            id: 'story-1-0',
            label: 'Main Street',
            public_url: 'https://example.com/a.png',
            status: 'ready',
          },
          {
            id: 'story-1-1',
            label: 'Castle',
            public_url: 'https://example.com/b.png',
            status: 'ready',
          },
          {
            id: 'story-1-2',
            label: 'Lagoon',
            public_url: 'https://example.com/c.png',
            status: 'approved',
          },
        ],
      },
    },
  });

  const regeneratedIds = [];
  const review = createYoutubeStillsReview({
    store,
    cfg: { youtubeEnabled: true },
    videoPipeline: {
      regenerateStillForReview: async (_ep, stillId, { direction }) => {
        regeneratedIds.push(stillId);
        return {
          id: stillId,
          label: stillId,
          public_url: `https://example.com/${stillId}-new.png`,
          status: 'ready',
          rejection_note: direction,
        };
      },
    },
  });

  let fresh = await store.getEpisodeById(episode.id);
  await assert.rejects(
    () => review.rejectStillsBulk(fresh, [], 'nope'),
    /Select at least one still/
  );
  await assert.rejects(
    () => review.rejectStillsBulk(fresh, ['missing-still'], 'nope'),
    /Still not found/
  );

  ({ episode: fresh } = await review.rejectStillsBulk(
    fresh,
    ['story-1-0', 'story-1-1', 'story-1-0'],
    'lake side, cooler light'
  ));
  assert.deepEqual(regeneratedIds, ['story-1-0', 'story-1-1']);
  const board = getStillsBoard(fresh);
  assert.equal(board.items.find((i) => i.id === 'story-1-0').status, 'ready');
  assert.equal(board.items.find((i) => i.id === 'story-1-1').status, 'ready');
  assert.equal(board.items.find((i) => i.id === 'story-1-2').status, 'approved');
  assert.match(board.items.find((i) => i.id === 'story-1-0').rejection_note, /lake side/);
  assert.match(board.items.find((i) => i.id === 'story-1-1').rejection_note, /cooler light/);
  assert.equal(board.status, 'ready_for_review');
});

test('publish and admin routes queue stills review instead of immediate video', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../lib/podcasts/routerAdmin.js'), 'utf8');
  const auto = fs.readFileSync(path.join(__dirname, '../lib/podcasts/autoPublish.js'), 'utf8');
  const pipeline = fs.readFileSync(path.join(__dirname, '../lib/podcasts/videoPipeline.js'), 'utf8');
  const view = fs.readFileSync(path.join(__dirname, '../views/admin-podcast-episode.ejs'), 'utf8');
  const place = fs.readFileSync(path.join(__dirname, '../lib/podcasts/placeReferencePhoto.js'), 'utf8');

  assert.match(admin, /youtube-stills\/prepare/);
  assert.match(admin, /youtube-stills\/create-video/);
  assert.match(admin, /youtube-stills\/reject-bulk/);
  assert.match(admin, /rejectStillsBulk/);
  assert.match(admin, /#youtube-stills-review/);
  assert.match(admin, /still-bulk-regenerate-queued/);
  assert.match(admin, /youtube-status/);
  assert.match(admin, /describeYoutubeProgress/);
  assert.match(admin, /stillsReview/);
  assert.match(admin, /Approve every YouTube still before creating the video/);
  assert.match(auto, /queueStillsPrepare/);
  assert.match(auto, /stills_review_required/);
  assert.match(pipeline, /prepareStillsBoard/);
  assert.match(pipeline, /regenerateStillForReview/);
  assert.match(pipeline, /stills_review_required/);
  assert.match(pipeline, /approvedStillsBoard/);
  assert.match(pipeline, /direction:\s*note/);
  assert.match(pipeline, /-r\$\{Date\.now/);
  assert.match(place, /extractPlaceFromDirection/);
  assert.match(place, /directionPlace/);
  assert.match(view, /YouTube stills review/);
  assert.match(view, /youtubeStatusPanel/);
  assert.match(view, /youtubeMeterFill/);
  assert.match(view, /Reject &amp; regenerate|Reject &amp; redo/);
  assert.match(view, /bulk-regenerate-stills/);
  assert.match(view, /still-bulk-check/);
  assert.match(view, /Regenerate selected/);
  assert.match(view, /stillSelectAll/);
  assert.match(view, /name="still_ids"/);
  assert.match(view, /Create YouTube video/);
  assert.match(view, /\?.*v=/);
});
