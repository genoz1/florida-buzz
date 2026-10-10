'use strict';

// fal.ai Gemini TTS — sourced from public fal model docs (fal-ai/gemini-tts).
// Florida Buzz repo has no verified "approved trailer" Pro-model lockfile.
// Override with PODCASTS_FAL_TTS_ENDPOINT / PODCASTS_FAL_TTS_MODEL if your
// account uses a different approved alias. Do not guess private trailer IDs.
const DEFAULT_FAL_TTS_ENDPOINT = 'fal-ai/gemini-tts';
const DEFAULT_FAL_TTS_MODEL = 'gemini-2.5-pro-tts';

const EPISODE_STATUSES = Object.freeze([
  'draft',
  'script_ready',
  'generating_audio',
  'preview_ready',
  'approved',
  'scheduled',
  'published',
  'failed',
]);

const DISNEY_SHOW_SLUG = 'florida-buzz-disney';

function config(env = process.env) {
  const temperature = Number(env.PODCASTS_TTS_TEMPERATURE ?? 0.85);
  const maxChars = Number(env.PODCASTS_TTS_SECTION_CHARS || 3500);
  const maxUploadMb = Number(env.PODCASTS_MAX_UPLOAD_MB || 80);
  return Object.freeze({
    // Public directory/show/episode/RSS are on unless explicitly disabled.
    // Paid fal TTS stays hard-off until PODCASTS_GENERATION_ENABLED=true.
    enabled: env.PODCASTS_ENABLED !== 'false',
    generation: env.PODCASTS_GENERATION_ENABLED === 'true',
    site: (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    falKey: env.FAL_KEY || null,
    falEndpoint: env.PODCASTS_FAL_TTS_ENDPOINT || DEFAULT_FAL_TTS_ENDPOINT,
    falModel: env.PODCASTS_FAL_TTS_MODEL || DEFAULT_FAL_TTS_MODEL,
    temperature: Number.isFinite(temperature) ? temperature : 0.85,
    languageCode: 'English (US)',
    outputFormat: 'mp3',
    ginaVoice: 'Aoede',
    dianeVoice: 'Zephyr',
    sectionMaxChars: Number.isFinite(maxChars) && maxChars > 500 ? maxChars : 3500,
    maxUploadBytes: (Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 80) * 1024 * 1024,
    audioBucket: env.PODCASTS_AUDIO_BUCKET || 'podcast-audio',
    artworkBucket: env.PODCASTS_ARTWORK_BUCKET || 'podcast-artwork',
    defaultShowSlug: DISNEY_SHOW_SLUG,
    falConfigVerifiedInRepo: false,
    falConfigSource:
      'Public fal.ai docs for fal-ai/gemini-tts (model gemini-2.5-pro-tts, voices Aoede/Zephyr). No in-repo approved-trailer verification found.',
  });
}

module.exports = {
  config,
  EPISODE_STATUSES,
  DISNEY_SHOW_SLUG,
  DEFAULT_FAL_TTS_ENDPOINT,
  DEFAULT_FAL_TTS_MODEL,
};
