'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SITE_CTA_SPOKEN,
  buildReelCaption,
  captionBeatsFromSpoken,
  easternDateString,
  ensureSiteCtaSpoken,
  expectedParkReelCountEt,
  formatCaptionLines,
  isAtOrAfterParkReelSlotEt,
  isTipsOrGuideContent,
  parkBrandFromArticle,
  parkReelFirstComment,
  parkReelPostedOnEasternDay,
  parkReelSpokenOpener,
  parkReelVoiceEnabled,
  rankParkReelCandidates,
  renderParkReelFromArticle,
  scoreParkReelCandidate,
  shouldRunParkReelCatchUp,
  slowZoomPanStill,
  spokenScriptFromArticle,
  stripAudioTags,
} = require('../lib/facebookParkReel');
const { DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/visualNews/config');

function ffprobeBin() {
  try {
    return require('ffprobe-static').path;
  } catch {
    return 'ffprobe';
  }
}

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function probeVideo(file) {
  const result = spawnSync(ffprobeBin(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio',
    '-of', 'json',
    file,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).streams[0];
}

describe('facebookParkReel voice + captions', () => {
  it('defaults Geno voice id to the podcast clone', () => {
    assert.equal(DEFAULT_ELEVEN_VOICE_GENO, 'bg7PC2IzyIDwYgytMiW1');
  });

  it('enables VO when ElevenLabs key is present unless explicitly disabled', () => {
    assert.equal(parkReelVoiceEnabled({ ELEVENLABS_API_KEY: 'sk_test' }), true);
    assert.equal(parkReelVoiceEnabled({ ELEVENLABS_API_KEY: 'sk_test', FB_PARK_REEL_WITH_VOICE: 'false' }), false);
    assert.equal(parkReelVoiceEnabled({}), false);
  });

  it('opens spoken script with the park name tip line + site CTA', () => {
    const spoken = spokenScriptFromArticle({
      title: 'Lightning Lane hit record highs — worth it?',
      dek: 'Pay only if that wait would wreck your Magic Kingdom morning',
      category: 'theme-parks',
    });
    const plain = stripAudioTags(spoken);
    assert.match(plain, /^Here's another Disney tip from The Florida Buzz\./i);
    assert.match(spoken, /Lightning Lane hit record highs/i);
    assert.match(plain, /Florida Buzz dot com/i);
    assert.match(spoken, /\[[^\]]+\]/);
    assert.equal(ensureSiteCtaSpoken(spoken), spoken);

    assert.equal(parkBrandFromArticle({ title: 'Epic Universe tip' }).label, 'Universal');
    assert.equal(parkBrandFromArticle({ title: 'Sesame Street Land at SeaWorld' }).label, 'SeaWorld');
    assert.equal(parkBrandFromArticle({ title: 'Disney Cruise transfers', category: 'cruises' }).label, 'Disney Cruise');
    assert.match(
      parkReelSpokenOpener({ title: 'Universal Orlando VIP Experience' }),
      /Here's another Universal tip from The Florida Buzz\./i
    );
  });

  it('always appends the Florida Buzz dot com CTA and tips-first first comment', () => {
    const withFollow = ensureSiteCtaSpoken('[curious] Lightning Lane hit highs. Follow Florida Buzz.');
    assert.match(stripAudioTags(withFollow), /Florida Buzz dot com/i);
    assert.doesNotMatch(stripAudioTags(withFollow), /Follow Florida Buzz\.?\s*$/i);
    assert.match(SITE_CTA_SPOKEN, /Florida Buzz dot com/i);

    const comment = parkReelFirstComment({ slug: 'lightning-lane-record-highs-worth-it' });
    assert.match(comment, /thefloridabuzz\.com\/article\/lightning-lane-record-highs-worth-it/i);
    assert.match(comment, /Tips and tricks/i);

    const guideComment = parkReelFirstComment({
      slug: 'disney-world-trip-itinerary-framework',
      is_evergreen: true,
    });
    assert.match(guideComment, /Full tips and tricks/i);
    assert.match(
      buildReelCaption({ title: 'Disney boat tips', dek: 'Keep docks moving', category: 'theme-parks' }),
      /Here's another Disney tip from The Florida Buzz/i
    );
  });

  it('ranks evergreen guides and tip posts ahead of plain park news', () => {
    const news = {
      slug: 'disney-believe-features',
      title: 'Disney Believe features announced',
      category: 'cruises',
      published_at: '2026-10-12T12:00:00.000Z',
    };
    const tip = {
      slug: 'disney-world-boat-transportation-tips-for-strollers',
      title: '3 Boat Tips to Keep Disney World Docks Moving',
      category: 'theme-parks',
      published_at: '2026-09-01T12:00:00.000Z',
    };
    const guide = {
      slug: 'disney-world-trip-itinerary-framework',
      title: 'Disney World Trip Itinerary Framework',
      category: 'theme-parks',
      is_evergreen: true,
      published_at: '2026-08-01T12:00:00.000Z',
    };
    assert.equal(isTipsOrGuideContent(guide), true);
    assert.equal(isTipsOrGuideContent(tip), true);
    assert.equal(isTipsOrGuideContent(news), false);
    assert.ok(scoreParkReelCandidate(guide) > scoreParkReelCandidate(tip));
    assert.ok(scoreParkReelCandidate(tip) > scoreParkReelCandidate(news));
    const ranked = rankParkReelCandidates([news, tip, guide], new Set());
    assert.deepEqual(ranked.map((r) => r.slug), [
      'disney-world-trip-itinerary-framework',
      'disney-world-boat-transportation-tips-for-strollers',
      'disney-believe-features',
    ]);
  });

  it('aligns kinetic captions to spoken beats across the audio duration', () => {
    const spoken = '[curious] Lightning Lane hit new highs. Standby fifty minutes. So is it worth it? Follow Florida Buzz.';
    const beats = captionBeatsFromSpoken(spoken, 12);
    assert.ok(beats.length >= 3);
    assert.equal(beats[0].start, 0);
    assert.ok(beats[beats.length - 1].end <= 12);
    assert.doesNotMatch(beats.map((b) => b.text).join(' '), /\[curious\]/);
    const plain = stripAudioTags(spoken).toLowerCase();
    assert.ok(plain.includes('lightning lane'));
    for (let i = 1; i < beats.length; i += 1) {
      assert.ok(beats[i].start >= beats[i - 1].start);
    }
  });

  it('wraps captions into short lines without mid-sentence ellipsis', () => {
    const lines = formatCaptionLines("Disney Cruise Line's Disney Believe will debut an Encanto stage show");
    assert.match(lines, /\\N/);
    assert.doesNotMatch(lines, /…$/);
    assert.ok(lines.split('\\N').length <= 3);

    const beats = captionBeatsFromSpoken(
      "[curious] Disney Cruise Line's Disney Believe will debut an Encanto stage show. [upbeat] Follow Florida Buzz.",
      10
    );
    const joined = beats.map((b) => b.text.replace(/\\N/g, ' ')).join(' ');
    assert.match(joined, /Disney Cruise/i);
    assert.match(joined, /Believe/i);
    assert.match(joined, /Encanto/i);
    assert.match(joined, /stage show/i);
    assert.doesNotMatch(joined, /Believe will \.\.\./);
    assert.doesNotMatch(joined, /…/);
  });

  it('burns the entire spoken script into captions (mute-friendly, not keyword hooks)', () => {
    const spoken = ensureSiteCtaSpoken(`[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes.`);
    const plain = stripAudioTags(spoken);
    const beats = captionBeatsFromSpoken(spoken, 26);
    const normalize = (s) => String(s)
      .replace(/\\N/g, ' ')
      .replace(/[—–…$-]/g, ' ')
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const joined = normalize(beats.map((b) => b.text).join(' '));
    const expectedWords = normalize(plain).split(' ').filter(Boolean);
    const missing = expectedWords.filter((w) => !joined.includes(w));
    assert.deepEqual(missing, [], `missing spoken words in captions: ${missing.join(', ')}`);
    // Full phrases — not keyword-only hooks like "Up to $229".
    assert.match(joined, /two hundred twenty nine/);
    assert.match(joined, /wreck your morning/);
    assert.match(joined, /automatic yes/);
    assert.match(joined, /florida buzz dot com/);
  });
});

describe('facebookParkReel daily catch-up', () => {
  it('formats Eastern calendar dates as YYYY-MM-DD', () => {
    // 2026-10-12T01:27Z is still Oct 11 evening in America/New_York (EDT).
    assert.equal(easternDateString(new Date('2026-10-12T01:27:40.000Z')), '2026-10-11');
    assert.equal(easternDateString(new Date('2026-10-12T14:30:00.000Z')), '2026-10-12');
  });

  it('expects 1 Reel after 10:30am ET and 2 after 7:00pm ET', () => {
    assert.equal(isAtOrAfterParkReelSlotEt(new Date('2026-10-12T14:29:00.000Z')), false); // 10:29 ET
    assert.equal(isAtOrAfterParkReelSlotEt(new Date('2026-10-12T14:30:00.000Z')), true); // 10:30 ET
    assert.equal(expectedParkReelCountEt(new Date('2026-10-12T14:29:00.000Z')), 0);
    assert.equal(expectedParkReelCountEt(new Date('2026-10-12T14:30:00.000Z')), 1);
    assert.equal(expectedParkReelCountEt(new Date('2026-10-12T22:59:00.000Z')), 1); // 6:59pm ET
    assert.equal(expectedParkReelCountEt(new Date('2026-10-12T23:00:00.000Z')), 2); // 7:00pm ET
  });

  it('detects whether a park-reel success already landed on the Eastern day', async () => {
    const client = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          like() { return this; },
          order() { return this; },
          limit() {
            return Promise.resolve({
              data: [{
                created_at: '2026-10-12T01:27:40.173Z', // Oct 11 ET
                detail: 'park-reel:disney-believe-features-and-venues-for-2027-cruises',
              }],
              error: null,
            });
          },
        };
      },
    };
    assert.equal(await parkReelPostedOnEasternDay(client, new Date('2026-10-12T15:00:00.000Z')), false);
    assert.equal(await parkReelPostedOnEasternDay(client, new Date('2026-10-11T20:00:00.000Z')), true);
  });

  it('catch-up fills morning then evening without blocking the second slot', async () => {
    const emptyClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          like() { return this; },
          order() { return this; },
          limit() { return Promise.resolve({ data: [], error: null }); },
        };
      },
    };
    assert.deepEqual(
      await shouldRunParkReelCatchUp(emptyClient, { now: new Date('2026-10-12T14:00:00.000Z') }),
      { run: false, reason: 'before_slot', expected: 0, posted: 0 }
    );
    const morningMiss = await shouldRunParkReelCatchUp(emptyClient, {
      now: new Date('2026-10-12T15:00:00.000Z'),
    });
    assert.equal(morningMiss.run, true);
    assert.equal(morningMiss.reason, 'missed_morning');
    assert.equal(morningMiss.expected, 1);

    const onePosted = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          like() { return this; },
          order() { return this; },
          limit() {
            return Promise.resolve({
              data: [{
                created_at: '2026-10-12T14:35:00.000Z', // 10:35am ET
                detail: 'park-reel:morning-tip',
              }],
              error: null,
            });
          },
        };
      },
    };
    const afterMorning = await shouldRunParkReelCatchUp(onePosted, {
      now: new Date('2026-10-12T18:00:00.000Z'), // 2pm ET
    });
    assert.equal(afterMorning.run, false);
    assert.equal(afterMorning.reason, 'morning_already_posted');

    const eveningMiss = await shouldRunParkReelCatchUp(onePosted, {
      now: new Date('2026-10-12T23:05:00.000Z'), // 7:05pm ET
    });
    assert.equal(eveningMiss.run, true);
    assert.equal(eveningMiss.reason, 'missed_evening');
    assert.equal(eveningMiss.expected, 2);
    assert.equal(eveningMiss.posted, 1);
  });
});

describe('facebookParkReel vertical render', () => {
  it('cover-crops landscape stills to 720x1280 with square pixels (DAR 9:16)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-reel-sar-'));
    const still = path.join(dir, 'landscape.jpg');
    const out = path.join(dir, 'out.mp4');
    const made = spawnSync(ffmpegBin(), [
      '-y', '-f', 'lavfi', '-i', 'color=c=orange:s=1920x1080:d=1', '-frames:v', '1', still,
    ], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);

    slowZoomPanStill(still, out, 30);
    const stream = probeVideo(out);
    assert.equal(stream.width, 720);
    assert.equal(stream.height, 1280);
    assert.equal(stream.sample_aspect_ratio, '1:1');
    assert.equal(stream.display_aspect_ratio, '9:16');
  });

  it('final silent master keeps 9:16 DAR after ASS burn from landscape still', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-reel-master-'));
    const still = path.join(dir, 'landscape.jpg');
    const made = spawnSync(ffmpegBin(), [
      '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=1600x900:d=1', '-frames:v', '1', still,
    ], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);

    const rendered = await renderParkReelFromArticle({
      slug: 'cruise-sar-check',
      title: "Disney Cruise Line's Disney Believe will debut Encanto",
      dek: 'Fort Lauderdale ship update',
      category: 'cruises',
      spoken: "[curious] Disney Cruise Line's Disney Believe will debut Encanto. Follow Florida Buzz.",
    }, {
      outDir: dir,
      tmpDir: path.join(dir, 'tmp'),
      imagePaths: [still],
      masterFileName: 'master.mp4',
      withVoice: false,
      durationSec: 6,
    });

    const stream = probeVideo(rendered.masterPath);
    assert.equal(stream.width, 720);
    assert.equal(stream.height, 1280);
    assert.equal(stream.sample_aspect_ratio, '1:1');
    assert.equal(stream.display_aspect_ratio, '9:16');
    assert.ok(rendered.captions.every((c) => !String(c.text).endsWith('…')));
  });
});
