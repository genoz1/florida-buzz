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
const { defaultSettings, createWeeklyDraft } = require('./weeklyDraft');
const { describeSchedule, WEEKDAY_NAMES } = require('./timeEt');
const { EVERGREEN_TOPICS } = require('./evergreenTopics');

function createAdminRouter({ store, cfg, pipeline, aiText, supabase = null, sendEmail = null, env = process.env }) {
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
      const platformLinks = show ? await store.listPlatformLinks(show.id) : [];
      let schedule = defaultSettings();
      let failures = [];
      let runs = [];
      try {
        schedule = (await store.getScheduleSettings(DISNEY_SHOW_SLUG)) || defaultSettings();
        failures = await store.listFailedGenerationRuns(DISNEY_SHOW_SLUG, 10);
        runs = await store.listGenerationRuns(DISNEY_SHOW_SLUG, null, 12);
      } catch (err) {
        console.warn('[podcasts] schedule tables unavailable — apply weekly schedule migration:', err.message);
      }
      res.render('admin-podcasts', {
        show,
        episodes,
        platformLinks,
        cfg,
        schedule,
        scheduleLabels: describeSchedule(schedule),
        weekdayNames: WEEKDAY_NAMES,
        failures,
        runs,
        createCsrf: csrf('create'),
        scheduleCsrf: csrf('schedule'),
        runCsrf: csrf('run'),
        notice: req.query.notice || null,
        error: req.query.error || null,
      });
    })
  );

  router.post(
    '/schedule',
    handle(async (req, res) => {
      if (!checkCsrf('schedule', req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const weekday = Number(req.body.generate_weekday);
      const hour = Number(req.body.generate_hour);
      const minute = Number(req.body.generate_minute || 0);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('Invalid generation weekday');
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid generation hour');
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('Invalid generation minute');
      await store.upsertScheduleSettings(DISNEY_SHOW_SLUG, {
        weekly_draft_enabled: req.body.weekly_draft_enabled === 'true' || req.body.weekly_draft_enabled === 'on',
        timezone: 'America/New_York',
        generate_weekday: weekday,
        generate_hour: hour,
        generate_minute: minute,
        intended_publish_weekday: 5,
        intended_publish_hour: 6,
        intended_publish_minute: 0,
        // Never allow enabling auto-publish from admin until explicitly built/tested.
        auto_publish_enabled: false,
        notify_email: String(req.body.notify_email || '').trim() || null,
      });
      res.redirect(303, '/admin/podcasts?notice=schedule-saved');
    })
  );

  router.post(
    '/platform-links',
    handle(async (req, res) => {
      if (!checkCsrf('schedule', req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const show = await defaultShow();
      if (!show) return res.status(503).send('Podcast show not seeded');
      const apple = String(req.body.apple_url || '').trim();
      const spotify = String(req.body.spotify_url || '').trim();
      if (apple) {
        const url = new URL(apple);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Apple URL must be http(s)');
        await store.upsertPlatformLink(show.id, 'Apple Podcasts', url.toString(), 1);
      }
      if (spotify) {
        const url = new URL(spotify);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Spotify URL must be http(s)');
        await store.upsertPlatformLink(show.id, 'Spotify', url.toString(), 2);
      }
      res.redirect(303, '/admin/podcasts?notice=platform-links-saved');
    })
  );

  router.post(
    '/run-weekly-draft',
    handle(async (req, res) => {
      if (!checkCsrf('run', req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const result = await createWeeklyDraft({
        store,
        supabase,
        cfg,
        aiText,
        pipeline,
        sendEmail,
        env,
        force: true,
      });
      if (result.skipped) {
        return res.redirect(
          303,
          `/admin/podcasts?notice=${encodeURIComponent(`Weekly draft skipped: ${result.reason}`)}`
        );
      }
      res.redirect(303, `/admin/podcasts/episodes/${result.episode.id}?notice=weekly-draft-ready`);
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
        evergreenTopics: EVERGREEN_TOPICS,
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
    '/episodes/:id/sources/:sourceId/delete',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      await store.deleteSource(req.params.sourceId);
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=source-removed`);
    })
  );

  router.post(
    '/episodes/:id/sources/custom',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const kind = String(req.body.source_kind || 'custom');
      if (!['guide', 'buzz_board', 'evergreen_topic', 'custom', 'article'].includes(kind)) {
        throw new Error('Invalid source kind');
      }
      const source = validateSourceInput(req.body);
      await store.addSource(episode.id, {
        ...source,
        source_kind: kind,
        external_ref: String(req.body.external_ref || '').trim() || null,
        meta: { added_via: 'admin' },
      });
      res.redirect(303, `/admin/podcasts/episodes/${episode.id}?notice=source-added`);
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
      const outline = String(req.body.outline_text || outlineRow?.content_text || episode.outline_json?.text || '').trim();
      let script = String(req.body.script_text || '').trim();
      let generated = false;
      if (!script) {
        if (!outline) throw new Error('Generate or paste an outline before creating a script');
        if (!aiText) throw new Error('AI text service unavailable');
        try {
          script = await generateConversation({ aiText, show, episode, outline, sources });
          generated = true;
        } catch (err) {
          const message = `Script AI unavailable: ${String(err.message || err).slice(0, 500)}`;
          await store.updateEpisode(episode.id, { last_error: message });
          throw new Error(message);
        }
      }
      const looksScaffold = /scaffold for review|not for publication until approved/i.test(script);
      await store.saveScript(episode.id, 'conversation', script, {
        target_minutes: looksScaffold ? 'scaffold-only' : '25-35',
        fallback: looksScaffold,
        generated,
      });
      const prevOutline =
        episode.outline_json && typeof episode.outline_json === 'object' ? episode.outline_json : {};
      await store.updateEpisode(episode.id, {
        script_text: script,
        last_error: looksScaffold ? episode.last_error || 'Scaffold script saved — generate a full AI script before publish.' : null,
        outline_json: {
          ...prevOutline,
          text: outline || prevOutline.text || '',
          // Real conversation scripts must not keep the weekly-draft fallback flag,
          // or the admin UI hides the script box forever.
          fallback: looksScaffold,
        },
      });
      if (['draft', 'failed'].includes(episode.status)) {
        if (looksScaffold) {
          // Avoid setStatus — it clears last_error, and scaffold drafts need that warning.
          await store.updateEpisode(episode.id, { status: 'script_ready' });
        } else {
          await store.setStatus(episode.id, 'script_ready');
          await store.updateEpisode(episode.id, { last_error: null });
        }
      } else if (episode.status === 'script_ready') {
        /* already ready */
      } else {
        // Keep preview/approved/published statuses when regenerating script text.
        await store.updateEpisode(episode.id, { updated_at: new Date().toISOString() });
      }
      res.redirect(
        303,
        `/admin/podcasts/episodes/${episode.id}?notice=${encodeURIComponent(
          generated ? 'script-generated' : 'script-saved'
        )}`
      );
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

  router.post(
    '/episodes/:id/reject-regenerate',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!checkCsrf(episode.id, req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      if (episode.status === 'published') throw new Error('Cannot regenerate a published episode');
      const result = await createWeeklyDraft({
        store,
        supabase,
        cfg,
        aiText,
        pipeline,
        sendEmail,
        env,
        force: true,
        weekKey: episode.week_key || null,
        rejectEpisodeId: episode.id,
      });
      if (result.skipped) throw new Error(`Regenerate skipped: ${result.reason}`);
      res.redirect(303, `/admin/podcasts/episodes/${result.episode.id}?notice=regenerated`);
    })
  );

  router.get(
    '/episodes/:id/audio',
    handle(async (req, res) => {
      const episode = await store.getEpisodeById(req.params.id);
      if (!episode) return res.status(404).send('Episode not found');
      if (!episode.audio_url) return res.status(404).send('No audio yet');
      res.redirect(302, episode.audio_url);
    })
  );

  router.post(
    '/runs/:runId/retry',
    handle(async (req, res) => {
      if (!checkCsrf('run', req.body.csrf)) return res.status(403).send('Expired or invalid form token');
      const runs = await store.listGenerationRuns(DISNEY_SHOW_SLUG, null, 50);
      const run = runs.find((r) => r.id === req.params.runId);
      if (!run) return res.status(404).send('Run not found');
      const result = await createWeeklyDraft({
        store,
        supabase,
        cfg,
        aiText,
        pipeline,
        sendEmail,
        env,
        force: true,
        weekKey: run.week_key,
        rejectEpisodeId: run.episode_id || null,
      });
      if (result.skipped) {
        return res.redirect(303, `/admin/podcasts?error=${encodeURIComponent(result.reason)}`);
      }
      res.redirect(303, `/admin/podcasts/episodes/${result.episode.id}?notice=retry-complete`);
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
    // Prefer a readable HTML error over a bare 503 so OpenAI/fal failures are actionable.
    res
      .status(500)
      .type('html')
      .send(
        `<!doctype html><html><body style="font:16px system-ui;max-width:720px;margin:40px auto;padding:20px">
        <h1>Podcast admin error</h1>
        <p>${String(err.message || err).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>
        <p><a href="/admin/podcasts">Back to podcast admin</a></p>
        </body></html>`
      );
  });

  return router;
}

module.exports = { createAdminRouter };
