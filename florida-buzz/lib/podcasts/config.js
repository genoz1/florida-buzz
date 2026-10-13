'use strict';

// fal.ai Gemini TTS — optional fallback only (public fal model docs).
const DEFAULT_FAL_TTS_ENDPOINT = 'fal-ai/gemini-tts';
const DEFAULT_FAL_TTS_MODEL = 'gemini-2.5-pro-tts';
const DEFAULT_FAL_SOLO_VOICE = 'Aoede';

// ElevenLabs Geno — Instant Voice Clone (production). Geno 2 PVC was too roomy/distant.
const DEFAULT_ELEVEN_MODEL = 'eleven_v4';
const DEFAULT_ELEVEN_VOICE_GENO = 'bg7PC2IzyIDwYgytMiW1'; // Instant Voice Clone
const DEFAULT_ELEVEN_VOICE_GENO_PVC = '5tg8WQNhwRAIGFxz4EFe'; // Geno 2 professional (do not use until re-cloned close-mic)
const DEFAULT_ELEVEN_VOICE_GENA = 'OZxMHsGaBmV5pjMIDIn0'; // Amy — Natural and Sweet
const DEFAULT_ELEVEN_OUTPUT_FORMAT = 'mp3_44100_128';

// Legacy fal multi-speaker presets (only used if PODCASTS_TTS_PROVIDER=fal with dual mode).
const DEFAULT_GENA_VOICE = 'Aoede';
const DEFAULT_DIANE_VOICE = 'Kore';

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

function resolveTtsProvider(env = {}) {
  const explicit = String(env.PODCASTS_TTS_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'elevenlabs' || explicit === 'fal') return explicit;
  // auto: prefer ElevenLabs when key present
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs';
  if (env.FAL_KEY) return 'fal';
  return 'elevenlabs';
}

function resolveHostMode(env = {}) {
  const raw = String(env.PODCASTS_HOST_MODE || 'solo').trim().toLowerCase();
  if (raw === 'dual' || raw === 'dual_msm' || raw === 'msm') return 'dual';
  return 'solo';
}

function config(env = process.env) {
  const temperature = Number(env.PODCASTS_TTS_TEMPERATURE ?? 0.9);
  const ttsProvider = resolveTtsProvider(env);
  const hostMode = resolveHostMode(env);
  // ElevenLabs solo chunks stay under reliable request sizes; fal can take larger packs.
  const defaultSectionChars = ttsProvider === 'elevenlabs' ? 4000 : 5600;
  const maxChars = Number(env.PODCASTS_TTS_SECTION_CHARS || defaultSectionChars);
  const maxUploadMb = Number(env.PODCASTS_MAX_UPLOAD_MB || 80);
  const genaVoice = normalizeVoice(env.PODCASTS_VOICE_GENA, DEFAULT_GENA_VOICE);
  const dianeVoice = normalizeVoice(env.PODCASTS_VOICE_DIANE, DEFAULT_DIANE_VOICE);
  const falSoloVoice = normalizeVoice(env.PODCASTS_VOICE_FAL_SOLO || env.PODCASTS_VOICE_GENA, DEFAULT_FAL_SOLO_VOICE);
  const elevenVoiceGeno = normalizeVoice(
    env.PODCASTS_ELEVEN_VOICE_GENO || env.PODCASTS_ELEVEN_VOICE_ID || env.ELEVENLABS_VOICE_GENO,
    DEFAULT_ELEVEN_VOICE_GENO
  );
  const elevenVoiceGena = normalizeVoice(
    env.PODCASTS_ELEVEN_VOICE_GENA || env.ELEVENLABS_VOICE_GENA,
    DEFAULT_ELEVEN_VOICE_GENA
  );
  return Object.freeze({
    // Public directory/show/episode/RSS are on unless explicitly disabled.
    // Paid TTS stays hard-off until PODCASTS_GENERATION_ENABLED=true.
    enabled: env.PODCASTS_ENABLED !== 'false',
    generation: env.PODCASTS_GENERATION_ENABLED === 'true',
    // After a full script draft, kick private ElevenLabs preview in the background.
    // Never publishes — review/approve/publish stay manual. Set false to keep TTS click-only.
    autoPreview:
      env.PODCASTS_GENERATION_ENABLED === 'true' &&
      String(env.PODCASTS_AUTO_PREVIEW_ENABLED ?? 'true').toLowerCase() !== 'false' &&
      String(env.PODCASTS_AUTO_PREVIEW_ENABLED ?? 'true') !== '0',
    weeklyCron: env.PODCASTS_WEEKLY_CRON_ENABLED !== 'false',
    site: (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    ownerEmail: env.PODCASTS_OWNER_EMAIL || 'floridabuzzonline@gmail.com',
    ttsProvider,
    hostMode,
    elevenApiKey: env.ELEVENLABS_API_KEY || null,
    elevenModel: env.PODCASTS_ELEVEN_MODEL || env.ELEVENLABS_MODEL_ID || DEFAULT_ELEVEN_MODEL,
    elevenVoiceGeno,
    elevenVoiceGena,
    elevenOutputFormat: env.PODCASTS_ELEVEN_OUTPUT_FORMAT || DEFAULT_ELEVEN_OUTPUT_FORMAT,
    // Instant Geno: calm conversational — avoid PVC “max closeness” settings that overcook Instant
    elevenStability: Number(env.PODCASTS_ELEVEN_STABILITY ?? 0.35),
    elevenSimilarityBoost: Number(env.PODCASTS_ELEVEN_SIMILARITY ?? 0.65),
    elevenStyle: Number(env.PODCASTS_ELEVEN_STYLE ?? 0),
    elevenSpeakerBoost: String(env.PODCASTS_ELEVEN_SPEAKER_BOOST ?? 'false').toLowerCase() === 'true',
    // Light presence only (heavy FX was for failed Geno 2 salvage)
    voicePresenceFx: String(env.PODCASTS_VOICE_PRESENCE_FX ?? 'true').toLowerCase() !== 'false',
    // Warmup trim was for Geno 2 cold-start; off for Instant by default
    voiceWarmupEnabled: String(env.PODCASTS_VOICE_WARMUP ?? 'false').toLowerCase() === 'true',
    falKey: env.FAL_KEY || null,
    falEndpoint: env.PODCASTS_FAL_TTS_ENDPOINT || DEFAULT_FAL_TTS_ENDPOINT,
    falModel: env.PODCASTS_FAL_TTS_MODEL || DEFAULT_FAL_TTS_MODEL,
    falSoloVoice,
    temperature: Number.isFinite(temperature) ? temperature : 0.9,
    languageCode: 'English (US)',
    outputFormat: 'mp3',
    genaVoice,
    dianeVoice,
    sectionMaxChars: Number.isFinite(maxChars) && maxChars > 500 ? maxChars : defaultSectionChars,
    falPollAttempts: Number(env.PODCASTS_FAL_POLL_ATTEMPTS || 180),
    falPollIntervalMs: Number(env.PODCASTS_FAL_POLL_INTERVAL_MS || 2000),
    falSectionRetries: Number(env.PODCASTS_FAL_SECTION_RETRIES || 2),
    elevenSectionRetries: Number(env.PODCASTS_ELEVEN_SECTION_RETRIES || 2),
    maxUploadBytes: (Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 80) * 1024 * 1024,
    audioBucket: env.PODCASTS_AUDIO_BUCKET || 'podcast-audio',
    artworkBucket: env.PODCASTS_ARTWORK_BUCKET || 'podcast-artwork',
    defaultShowSlug: DISNEY_SHOW_SLUG,
    falConfigVerifiedInRepo: false,
    falConfigSource:
      `Optional fal fallback for fal-ai/gemini-tts (model gemini-2.5-pro-tts, solo voice ${falSoloVoice}). Production default is ElevenLabs ${DEFAULT_ELEVEN_MODEL} solo Geno.`,
  });
}

module.exports = {
  config,
  resolveTtsProvider,
  resolveHostMode,
  EPISODE_STATUSES,
  DISNEY_SHOW_SLUG,
  DEFAULT_FAL_TTS_ENDPOINT,
  DEFAULT_FAL_TTS_MODEL,
  DEFAULT_FAL_SOLO_VOICE,
  DEFAULT_GENA_VOICE,
  DEFAULT_DIANE_VOICE,
  DEFAULT_ELEVEN_MODEL,
  DEFAULT_ELEVEN_VOICE_GENO,
  DEFAULT_ELEVEN_VOICE_GENO_PVC,
  DEFAULT_ELEVEN_VOICE_GENA,
  DEFAULT_ELEVEN_OUTPUT_FORMAT,
};
