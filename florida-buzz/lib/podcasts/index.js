'use strict';

const { config } = require('./config');
const { createStore } = require('./store');
const { createFalTts } = require('./falTts');
const { createAudioPipeline } = require('./audioPipeline');
const { createPublicRouter } = require('./routerPublic');
const { createAdminRouter } = require('./routerAdmin');

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
  let aiText = null;
  try {
    aiText = require('../aiText');
  } catch {
    aiText = null;
  }
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal,
    ffmpegPath: resolveFfmpegPath(env),
  });
  return { cfg, store, fal, pipeline, aiText };
}

function mount(app, env = process.env) {
  const cfg = config(env);
  if (!cfg.enabled) {
    console.log('[podcasts disabled] set PODCASTS_ENABLED=true to mount public/admin podcast routes');
    return { cfg, mounted: false };
  }

  const runtime = production(env);
  app.use('/podcasts', createPublicRouter({ store: runtime.store, cfg: runtime.cfg }));
  try {
    app.use(
      '/admin/podcasts',
      createAdminRouter({
        store: runtime.store,
        cfg: runtime.cfg,
        pipeline: runtime.pipeline,
        aiText: runtime.aiText,
        env,
      })
    );
  } catch (err) {
    console.error('[podcasts] admin router not mounted:', err.message);
  }
  console.log(
    `[podcasts] mounted (generation=${runtime.cfg.generation ? 'ON' : 'OFF'}; fal endpoint=${runtime.cfg.falEndpoint}; model=${runtime.cfg.falModel})`
  );
  return { ...runtime, mounted: true };
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
  createAudioPipeline,
  createPublicRouter,
  createAdminRouter,
};
