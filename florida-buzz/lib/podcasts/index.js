'use strict';

const { config } = require('./config');
const { createStore } = require('./store');
const { createFalTts } = require('./falTts');
const { createElevenTts } = require('./elevenTts');
const { createAudioPipeline } = require('./audioPipeline');
const { maybeAutoPublishAfterPreview } = require('./autoPublish');
const { createPublicRouter } = require('./routerPublic');
const { createAdminRouter } = require('./routerAdmin');
const { createVideoPipeline } = require('./videoPipeline');

function resolveFfmpegPath(env = process.env) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function production(env = process.env) {
  const cfg = config(env);
  let supabase = null;
  try {
    supabase = require('../supabase').supabase;
  } catch {
    supabase = null;
  }
  const store = createStore(supabase);
  const fal = createFalTts(cfg);
  const eleven = createElevenTts(cfg);
  let aiText = null;
  try {
    aiText = require('../aiText');
  } catch {
    aiText = null;
  }
  const ffmpegPath = resolveFfmpegPath(env);
  const videoPipeline = createVideoPipeline({ cfg, store, supabase, aiText, ffmpegPath });
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal,
    eleven,
    ffmpegPath,
    onPreviewReady: (episode) =>
      maybeAutoPublishAfterPreview({ store, episode, cfg, videoPipeline }),
  });
  return { cfg, store, fal, eleven, pipeline, videoPipeline, aiText, supabase };
}

function mount(app, env = process.env) {
  const cfg = config(env);
  if (!cfg.enabled) {
    console.log('[podcasts disabled] PODCASTS_ENABLED=false — public/admin podcast routes not mounted');
    return { cfg, mounted: false };
  }

  const runtime = production(env);
  let sendEmail = null;
  try {
    sendEmail = require('../resend').sendEmail;
  } catch {
    sendEmail = null;
  }
  app.use('/podcasts', createPublicRouter({ store: runtime.store, cfg: runtime.cfg }));
  try {
    app.use(
      '/admin/podcasts',
      createAdminRouter({
        store: runtime.store,
        cfg: runtime.cfg,
        pipeline: runtime.pipeline,
        videoPipeline: runtime.videoPipeline,
        aiText: runtime.aiText,
        supabase: runtime.supabase,
        sendEmail,
        env,
      })
    );
  } catch (err) {
    console.error('[podcasts] admin router not mounted:', err.message);
  }
  console.log(
    `[podcasts] mounted (generation=${runtime.cfg.generation ? 'ON' : 'OFF'}; autoPreview=${runtime.cfg.autoPreview ? 'ON' : 'OFF'}; autoPublish=${runtime.cfg.autoPublish ? 'ON' : 'OFF'}; weeklyCron=${runtime.cfg.weeklyCron ? 'ON' : 'OFF'}; youtube=${runtime.cfg.youtubeEnabled ? 'ON' : 'OFF'}; tts=${runtime.cfg.ttsProvider}; elevenModel=${runtime.cfg.elevenModel}; fal endpoint=${runtime.cfg.falEndpoint})`
  );
  return { ...runtime, sendEmail, mounted: true };
}

async function sitemapEntries(env = process.env) {
  const cfg = config(env);
  if (!cfg.enabled) {
    return [
      { loc: `${cfg.site}/podcasts`, priority: '0.5' },
      { loc: `${cfg.site}/podcasts/${cfg.defaultShowSlug}`, priority: '0.5' },
    ];
  }
  try {
    const { store } = production(env);
    return store.sitemapEntries(cfg.site);
  } catch {
    return [
      { loc: `${cfg.site}/podcasts`, priority: '0.5' },
      { loc: `${cfg.site}/podcasts/${cfg.defaultShowSlug}`, priority: '0.5' },
    ];
  }
}

module.exports = {
  mount,
  production,
  config,
  sitemapEntries,
  createStore,
  createFalTts,
  createElevenTts,
  createAudioPipeline,
  createPublicRouter,
  createAdminRouter,
  createVideoPipeline,
  createWeeklyDraft: (...args) => require('./weeklyDraft').createWeeklyDraft(...args),
  tickWeeklyDraft: (...args) => require('./weeklyDraft').tickWeeklyDraft(...args),
};
