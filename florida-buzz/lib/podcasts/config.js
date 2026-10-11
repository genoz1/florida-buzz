'use strict';

// fal.ai Gemini TTS — sourced from public fal model docs (fal-ai/gemini-tts).
// Florida Buzz repo has no verified "approved trailer" Pro-model lockfile.
// Override with PODCASTS_FAL_TTS_ENDPOINT / PODCASTS_FAL_TTS_MODEL if your
// account uses a different approved alias. Do not guess private trailer IDs.
const DEFAULT_FAL_TTS_ENDPOINT = 'fal-ai/gemini-tts';
const DEFAULT_FAL_TTS_MODEL = 'gemini-2.5-pro-tts';

// Multi-speaker voice presets from fal-ai/gemini-tts (same enum on speakers[].voice).
// Catalog is finite (~30 names). Female-leaning labels from fal/Google docs:
//   Aoede = warm/melodic (breezy), Callirrhoe = easy-going, Sulafat = warm,
//   Achernar = soft, Vindemiatrix = gentle, Achird = friendly, Kore = firm,
//   Zephyr = bright/clear (can read assistant-like), Leda = youthful (too young),
//   Gacrux = mature (can read older). Skip male-coded presets (Puck, Charon,
//   Fenrir, Orus, etc.) for these hosts.
// Defaults: Gena=Aoede; Diane=Callirrhoe — same ~30s American-mom lane, easier-
// going timbre contrast vs Aoede (replaces Zephyr, which sounded bright/AI-ish).
const DEFAULT_GENA_VOICE = 'Aoede';
const DEFAULT_DIANE_VOICE = 'Callirrhoe';

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

function normalizeVoice(raw, fallback) {
  const voice = String(raw || '').trim();
  return voice || fallback;
}

function config(env = process.env) {
  const temperature = Number(env.PODCASTS_TTS_TEMPERATURE ?? 0.9);
  // Larger multi-turn chunks sound less metronomic than many tiny one-volley sections.
  // fal Pro still times out on huge prompts — ~5600 chars keeps several host exchanges per job.
  const maxChars = Number(env.PODCASTS_TTS_SECTION_CHARS || 5600);
  const maxUploadMb = Number(env.PODCASTS_MAX_UPLOAD_MB || 80);
  const genaVoice = normalizeVoice(env.PODCASTS_VOICE_GENA, DEFAULT_GENA_VOICE);
  const dianeVoice = normalizeVoice(env.PODCASTS_VOICE_DIANE, DEFAULT_DIANE_VOICE);
  return Object.freeze({
    // Public directory/show/episode/RSS are on unless explicitly disabled.
    // Paid fal TTS stays hard-off until PODCASTS_GENERATION_ENABLED=true.
    enabled: env.PODCASTS_ENABLED !== 'false',
    generation: env.PODCASTS_GENERATION_ENABLED === 'true',
    // Hourly tick may run; actual weekly drafts still require admin schedule enable.
    weeklyCron: env.PODCASTS_WEEKLY_CRON_ENABLED !== 'false',
    site: (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    // Podcast-owner inbox for Apple/Spotify verification (must be an inbox Florida Buzz can access).
    ownerEmail: env.PODCASTS_OWNER_EMAIL || 'floridabuzzonline@gmail.com',
    falKey: env.FAL_KEY || null,
    falEndpoint: env.PODCASTS_FAL_TTS_ENDPOINT || DEFAULT_FAL_TTS_ENDPOINT,
    falModel: env.PODCASTS_FAL_TTS_MODEL || DEFAULT_FAL_TTS_MODEL,
    temperature: Number.isFinite(temperature) ? temperature : 0.9,
    languageCode: 'English (US)',
    outputFormat: 'mp3',
    genaVoice,
    dianeVoice,
    sectionMaxChars: Number.isFinite(maxChars) && maxChars > 500 ? maxChars : 5600,
    // fal Pro multi-speaker chunks can take several minutes; 90×2s was too short.
    falPollAttempts: Number(env.PODCASTS_FAL_POLL_ATTEMPTS || 180),
    falPollIntervalMs: Number(env.PODCASTS_FAL_POLL_INTERVAL_MS || 2000),
    falSectionRetries: Number(env.PODCASTS_FAL_SECTION_RETRIES || 2),
    maxUploadBytes: (Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 80) * 1024 * 1024,
    audioBucket: env.PODCASTS_AUDIO_BUCKET || 'podcast-audio',
    artworkBucket: env.PODCASTS_ARTWORK_BUCKET || 'podcast-artwork',
    defaultShowSlug: DISNEY_SHOW_SLUG,
    falConfigVerifiedInRepo: false,
    falConfigSource:
      `Public fal.ai docs for fal-ai/gemini-tts (model gemini-2.5-pro-tts, voices ${genaVoice}/${dianeVoice}). No in-repo approved-trailer verification found.`,
  });
}

module.exports = {
  config,
  EPISODE_STATUSES,
  DISNEY_SHOW_SLUG,
  DEFAULT_FAL_TTS_ENDPOINT,
  DEFAULT_FAL_TTS_MODEL,
  DEFAULT_GENA_VOICE,
  DEFAULT_DIANE_VOICE,
};
