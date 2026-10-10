'use strict';

const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const {
  validateEpisodeFields,
  validateSourceInput,
  assertAudioUpload,
  assertArtworkUpload,
  slugify,
} = require('./validation');
const { sanitizeShowNotesHtml } = require('./sanitize');
const { ensureShowNotesDisclosures } = require('./hosts');
const { generateOutline, generateConversation } = require('./script');
const { DISNEY_SHOW_SLUG } = require('./config');

function createAdminRouter({ store, cfg, pipeline, aiText, env = process.env }) {
  const router = express.Router();
  const secret = env.ADMIN_PASSWORD;
  if (!secret || secret.length < 12) {
    throw new Error('Podcast admin requires an existing ADMIN_PASSWORD of at least 12 characters');
  }
  const equal = (a, b) => {
    const x = Buffer.from(a || '');
    const y = Buffer.from(b || '');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const csrf = (id, period = Math.floor(Date.now() / 3600000)) =>
    crypto.createHmac('sha256', secret).update(`podcasts:${id}:${period}`).digest('hex');
  const checkCsrf = (id, token) => {
    const period = Math.floor(Date.now() / 3600000);
    return equal(token, csrf(id, period)) || equal(token, csrf(id, period - 1));
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUploadBytes },
  });

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const raw = Buffer.from((req.get('authorization') || '').replace(/^Basic /, ''), 'base64').toString();
    const separator = raw.indexOf(':');
    if (!equal(separator >= 0 ? raw.slice(separator + 1) : '', secret)) {
      return res
        .status(401)
        .set('WWW-Authenticate', 'Basic realm="Florida Buzz Podcast admin"')
        .send('Admin authentication required');
    }
    next();
  });

  const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  async function defaultShow() {
    return store.getShow(DISNEY_SHOW_SLUG);
  }

  router.get(
    '/',
    handle(async (req, res) => {
      const show = await defaultShow();
      const episodes = show ? await store.listEpisodes(show.id) : [];
      res.render('admin-podcasts', {
        show,
        episodes,
        cfg,
        createCsrf: csrf('create'),
        notice: req.query.notice || null,
      });
    })
  );

  router.post(
    '/episodes',
    handle(async (req, res) => {
      const show = await defaultShow();
      if (!show) return res.status(503).send('Podcast show not seeded');
      if (!checkCsrf('create', req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const fields = validateEpisodeFields(req.body);
      if (!fields.slug) fields.slug = slugify(fields.title);
      fields.show_notes_html = sanitizeShowNotesHtml(ensureShowNotesDisclosures(fields.show_notes_html));
      const episode = await store.createEpisode(show.id, fields);
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}`);
    })
  );

  router.get(
    '/episodes/:id',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      const show = await defaultShow();
      const sources = await store.listSources(episode.id);
      const jobs = await store.listJobs(episode.id);
      const outline = await store.latestScript(episode.id, 'outline');
      const conversation = await store.latestScript(episode.id, 'conversation');
      res.render('admin-podcast-episode', {
        show,
        episode,
        sources,
        jobs,
        outline,
        conversation,
        cfg,
        csrf: csrf(episode.id),
        createCsrf: csrf('create'),
        notice: req.query.notice || null,
        error: req.query.error || null,
      });
    })
  );

  router.post(
    '/episodes/:id',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const fields = validateEpisodeFields({ ...episode, ...req.body, slug: req.body.slug || episode.slug });
      await store.updateEpisode(episode.id, {
        title: fields.title,
        description: fields.description,
        show_notes_html: sanitizeShowNotesHtml(ensureShowNotesDisclosures(fields.show_notes_html)),
        episode_number: fields.episode_number,
        artwork_alt: fields.artwork_alt,
        slug: fields.slug || episode.slug,
      });
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=saved`);
    })
  );

  router.post(
    '/episodes/:id/sources',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const source = validateSourceInput(req.body);
      await store.addSource(episode.id, source);
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=source-added`);
    })
  );

  router.post(
    '/episodes/:id/sources/:sourceId/toggle',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      await store.setSourceIncluded(req.params.sourceId, req.body.included !== 'false');
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=source-updated`);
    })
  );

  router.post(
    '/episodes/:id/outline',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const show = await defaultShow();
      const sources = await store.listSources(episode.id);
      let outline = String(req.body.outline_text || '').trim();
      if (!outline) {
        if (!aiText) throw new Error('AI text service unavailable');
        outline = await generateOutline({ aiText, show, episode, sources });
      }
      await store.saveScript(episode.id, 'outline', outline);
      await store.updateEpisode(episode.id, { outline_json: { text: outline } });
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=outline-saved`);
    })
  );

  router.post(
    '/episodes/:id/script',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const show = await defaultShow();
      const sources = await store.listSources(episode.id);
      const outlineRow = await store.latestScript(episode.id, 'outline');
      const outline = String(req.body.outline_text || outlineRow?.content_text || '').trim();
      let script = String(req.body.script_text || '').trim();
      if (!script) {
        if (!outline) throw new Error('Generate or paste an outline before creating a script');
        if (!aiText) throw new Error('AI text service unavailable');
        script = await generateConversation({ aiText, show, episode, outline, sources });
      }
      await store.saveScript(episode.id, 'conversation', script);
      await store.updateEpisode(episode.id, { script_text: script });
      if (['draft', 'failed'].includes(episode.status)) {
        await store.setStatus(episode.id, 'script_ready');
      } else if (episode.status === 'script_ready') {
        /* already ready */
      } else {
        // Keep preview/approved/published statuses when regenerating script text.
        await store.updateEpisode(episode.id, { updated_at: new Date().toISOString() });
      }
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=script-saved`);
    })
  );

  router.post(
    '/episodes/:id/generate-audio',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      if (!cfg.generation) {
        return res.redirect(
          303,
          `/admin/podcasts/episodes/${episode.id}?error=${encodeURIComponent('Audio generation is disabled (PODCASTS_GENERATION_ENABLED!=true). No fal call was made.')}`
        );
      }
      const script = episode.script_text || (await store.latestScript(episode.id, 'conversation'))?.content_text;
      if (!script) {
        return res.redirect(303, `/admin/podcasts/episodes/${episode.id}?error=${encodeURIComponent('Script required')}`);
      }
      // Intentionally not awaited in background for v1 clarity: admin waits / retries.
      // Still never publishes.
      await pipeline.generatePreview(episode, script);
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=preview-ready`);
    })
  );

  router.post(
    '/episodes/:id/upload-audio',
    upload.single('audio'),
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      assertAudioUpload(req.file, cfg.maxUploadBytes);
      await pipeline.attachUploadedAudio(episode, req.file.buffer, req.file.originalname);
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=audio-uploaded`);
    })
  );

  router.post(
    '/episodes/:id/upload-artwork',
    upload.single('artwork'),
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      assertArtworkUpload(req.file, cfg.maxUploadBytes);
      const pathName = `${episode.show_id}/${episode.id}/art-${Date.now()}.${(req.file.mimetype || '').split('/')[1] || 'jpg'}`;
      let publicUrl = `memory://${pathName}`;
      if (typeof store.uploadBytes === 'function') {
        publicUrl = await store.uploadBytes(cfg.artworkBucket, pathName, req.file.buffer, req.file.mimetype);
      }
      const asset = await store.createAsset({
        kind: 'artwork',
        storage_path: pathName,
        public_url: publicUrl,
        content_type: req.file.mimetype,
        byte_size: req.file.size,
        alt_text: req.body.artwork_alt || episode.artwork_alt || episode.title,
      });
      await store.updateEpisode(episode.id, {
        artwork_asset_id: asset.id,
        artwork_url: publicUrl,
        artwork_alt: req.body.artwork_alt || episode.artwork_alt || episode.title,
      });
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=artwork-uploaded`);
    })
  );

  router.post(
    '/episodes/:id/approve',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      if (!episode.audio_url) throw new Error('Cannot approve without audio');
      await store.setStatus(episode.id, 'approved');
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=approved`);
    })
  );

  router.post(
    '/episodes/:id/schedule',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const when = new Date(req.body.scheduled_for);
      if (Number.isNaN(when.getTime())) throw new Error('Invalid schedule time');
      await store.updateEpisode(episode.id, { scheduled_for: when.toISOString() });
      await store.setStatus(episode.id, 'scheduled');
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=scheduled`);
    })
  );

  router.post(
    '/episodes/:id/publish',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      if (!['approved', 'scheduled'].includes(episode.status)) {
        throw new Error('Publish requires an approved (or scheduled) episode');
      }
      if (!episode.audio_url) throw new Error('Cannot publish without permanent audio URL');
      await store.setStatus(episode.id, 'published');
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=published`);
    })
  );

  router.post(
    '/episodes/:id/unpublish',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      await store.updateEpisode(episode.id, { status: 'approved', published_at: null });
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=unpublished`);
    })
  );

  router.use((err, req, res, next) => {
    console.error('[podcasts admin]', err.message);
    const id = req.params.id;
    if (id) {
      return res.redirect(
        303,
        `/admin/podcasts/episodes/${id}?error=${encodeURIComponent(err.message.slice(0, 300))}`
      );
    }
    res.status(503).send('Podcast admin temporarily unavailable.');
  });

  return router;
}

module.exports = { createAdminRouter };
