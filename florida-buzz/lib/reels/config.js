'use strict';

const KLING = 'fal-ai/kling-video/v3/standard/text-to-video';
const QWEN = 'fal-ai/qwen-3-tts/text-to-speech/1.7b';
const WHISPER = 'fal-ai/whisper';
const MERGE_VIDEOS = 'fal-ai/ffmpeg-api/merge-videos';
const MERGE_AUDIO_VIDEO = 'fal-ai/ffmpeg-api/merge-audio-video';
const AUTO_SUBTITLE = 'fal-ai/workflow-utilities/auto-subtitle';
function config(env = process.env) {
  const amount = (key) => {
    const value = Number(env[key] || 0);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}`);
    return value;
  };
  const seconds = Number(env.REELS_SHOT_SECONDS || 5);
  if (![5, 6].includes(seconds)) throw new Error('REELS_SHOT_SECONDS must be 5 or 6');
  return Object.freeze({
    enabled: env.REELS_ENABLED === 'true',
    generation: env.REELS_GENERATION_ENABLED === 'true',
    schedules: env.REELS_SCHEDULES_ENABLED === 'true',
    autoPublish: env.REELS_AUTO_PUBLISH_ENABLED === 'true',
    cron: env.REELS_CRON || '0 10 * * 1,3,5',
    ideasCron: env.REELS_IDEAS_CRON || '0 9 * * 0',
    timezone: 'America/New_York', seconds,
    caps: { package: amount('REELS_PACKAGE_CAP_USD'), day: amount('REELS_DAY_CAP_USD'),
      week: amount('REELS_WEEK_CAP_USD'), month: amount('REELS_MONTH_CAP_USD'), single: 2 },
    site: (env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    falKey: env.FAL_KEY, billingKey: env.FAL_BILLING_KEY || env.FAL_KEY,
    voicePath: 'voice/approved-qwen.safetensors', bucket: 'guide-reels',
    voiceHash: env.REELS_VOICE_SHA256,
  });
}
const voiceInput = (text, embedding) => ({ text, language: 'English', speaker_voice_embedding_file_url: embedding,
  reference_text: 'A lot of people get to Magic Kingdom a little later than they probably should.',
  max_new_tokens: 1000, top_k: 50, top_p: 1, temperature: 0.9, repetition_penalty: 1.05,
  subtalker_dosample: true, subtalker_top_k: 50, subtalker_top_p: 1, subtalker_temperature: 0.9 });
const videoInput = (prompt, seconds = 5) => ({ prompt, duration: String(seconds),
  aspect_ratio: '9:16', generate_audio: false, cfg_scale: 0.5 });
module.exports = { config, KLING, QWEN, WHISPER, MERGE_VIDEOS, MERGE_AUDIO_VIDEO, AUTO_SUBTITLE, voiceInput, videoInput };
