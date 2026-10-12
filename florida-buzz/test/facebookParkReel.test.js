'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  captionBeatsFromSpoken,
  parkReelVoiceEnabled,
  spokenScriptFromArticle,
  stripAudioTags,
} = require('../lib/facebookParkReel');
const { DEFAULT_ELEVEN_VOICE_GENO } = require('../lib/visualNews/config');

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
});
