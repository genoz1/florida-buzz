'use strict';

/**
 * Visual news shorts — ElevenLabs direct TTS + local ffmpeg only.
 * This feature never uses fal.ai (no FAL_KEY, no fal ElevenLabs proxy, no fal ffmpeg).
 */

const DEFAULT_ELEVEN_MODEL = 'eleven_v4';
/** Geno — same ElevenLabs voice as Florida Buzz podcast host (`lib/podcasts/config.js`). */
const DEFAULT_ELEVEN_VOICE_GENO = 'EK1vMGRoEG4LXcQRzXam'; // geno 11 Instant (same as podcasts)
const DEFAULT_VOICE = DEFAULT_ELEVEN_VOICE_GENO;
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 1280;
const DEFAULT_FPS = 30;
const MIN_DURATION_S = 18;
const MAX_DURATION_S = 28;

function config(env = process.env) {
  const width = Number(env.VISUAL_NEWS_WIDTH || DEFAULT_WIDTH);
  const height = Number(env.VISUAL_NEWS_HEIGHT || DEFAULT_HEIGHT);
  const fps = Number(env.VISUAL_NEWS_FPS || DEFAULT_FPS);
  return Object.freeze({
    elevenApiKey: env.ELEVENLABS_API_KEY || env.XI_API_KEY || null,
    elevenModel: env.VISUAL_NEWS_ELEVEN_MODEL || env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVEN_MODEL,
    elevenVoiceId:
      env.VISUAL_NEWS_ELEVEN_VOICE ||
      env.PODCASTS_ELEVEN_VOICE_GENO ||
      env.ELEVENLABS_VOICE_GENO ||
      env.ELEVENLABS_VOICE_SAMPLE ||
      env.ELEVENLABS_VOICE_ID ||
      DEFAULT_VOICE,
    elevenOutputFormat: env.VISUAL_NEWS_ELEVEN_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT,
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_HEIGHT,
    fps: Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS,
    minDurationS: MIN_DURATION_S,
    maxDurationS: MAX_DURATION_S,
    brand: 'THE FLORIDA BUZZ',
    siteUrl: (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    // Explicit: this pipeline must not depend on fal.
    usesFal: false,
    defaultVoiceName: 'Geno',
    defaultVoiceId: DEFAULT_ELEVEN_VOICE_GENO,
  });
}

module.exports = {
  config,
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_ELEVEN_VOICE_GENO,
  DEFAULT_VOICE,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_FPS,
  MIN_DURATION_S,
  MAX_DURATION_S,
};
