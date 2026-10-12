'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  captionBeatsFromSpoken,
  formatCaptionLines,
  parkReelVoiceEnabled,
  renderParkReelFromArticle,
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

  it('builds a spoken Geno script from article title/dek', () => {
    const spoken = spokenScriptFromArticle({
      title: 'Lightning Lane hit record highs — worth it?',
      dek: 'Pay only if that wait would wreck your Magic Kingdom morning',
    });
    assert.match(spoken, /Lightning Lane hit record highs/i);
    assert.match(spoken, /Follow Florida Buzz/i);
    assert.match(spoken, /\[[^\]]+\]/);
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
    assert.ok(lines.split('\\N').every((line) => line.length <= 16));

    const beats = captionBeatsFromSpoken(
      "[curious] Disney Cruise Line's Disney Believe will debut an Encanto stage show. [upbeat] Follow Florida Buzz.",
      10
    );
    const joined = beats.map((b) => b.text.replace(/\\N/g, ' ')).join(' ');
    assert.match(joined, /Disney Cruise Line/i);
    assert.match(joined, /Encanto/i);
    assert.doesNotMatch(joined, /Believe will \.\.\./);
    assert.doesNotMatch(joined, /…/);
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
