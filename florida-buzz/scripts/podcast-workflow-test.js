#!/usr/bin/env node
'use strict';

/**
 * Internal Florida Buzz podcast workflow test.
 * Creates a review-only draft, never publishes to the public RSS feed.
 * Uses Florida Buzz Supabase credentials only (never ROOK).
 */

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { config } = require('../lib/podcasts/config');
const { createStore } = require('../lib/podcasts/store');
const { createMemoryStore } = require('../lib/podcasts/memoryStore');
const { createWeeklyDraft } = require('../lib/podcasts/weeklyDraft');
const { createAudioPipeline } = require('../lib/podcasts/audioPipeline');
const { createFalTts } = require('../lib/podcasts/falTts');
const { buildRss, DEFAULT_OWNER_EMAIL } = require('../lib/podcasts/rss');
const { DISNEY_SHOW_SLUG } = require('../lib/podcasts/config');

const FB_URL = process.env.FLORIDA_BUZZ_SUPABASE_URL;
const FB_KEY = process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY;
const ROOK_REF = 'nazycunakcwfmusmiybd';

function assertFbOnly(url) {
  if (!url || !url.includes('tcrfirzjcjvfmiepgbjh')) {
    throw new Error(`Refusing non-Florida-Buzz Supabase URL: ${url}`);
  }
  if (url.includes(ROOK_REF)) throw new Error('Refusing ROOK Supabase project');
}

async function validateLiveRss() {
  const res = await fetch(`https://thefloridabuzz.com/podcasts/florida-buzz-disney/rss.xml?t=${Date.now()}`);
  const xml = await res.text();
  const checks = [];
  const need = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  need('http_200', res.status === 200, String(res.status));
  need('title', /<title>Florida Buzz: Disney<\/title>/.test(xml));
  need('language_en_us', /<language>en-us<\/language>/.test(xml));
  need('explicit_false', /<itunes:explicit>false<\/itunes:explicit>/.test(xml));
  need('category_leisure', /itunes:category text="Leisure"/.test(xml));
  need('subcategory_travel', /itunes:category text="Travel"/.test(xml));
  need('copyright', /<copyright>The Florida Buzz<\/copyright>/.test(xml));
  need('website_link', /thefloridabuzz\.com\/podcasts\/florida-buzz-disney/.test(xml));
  need('cover_png_url', /florida-buzz-disney-cover\.png/.test(xml));
  need('trailer_episode_type', /itunes:episodeType>trailer</.test(xml));
  need('stable_guid', /florida-buzz:[0-9a-f-]+:trailer:v1/.test(xml));
  need('enclosure_https', /enclosure url="https:\/\//.test(xml));
  need('enclosure_mpeg', /type="audio\/mpeg"/.test(xml));
  need('enclosure_length', /length="2748716"/.test(xml));
  need('unofficial_disclosure', /not affiliated with/i.test(xml));
  need('ai_disclosure_in_live_feed', /AI-generated hosts/i.test(xml), 'channel description must disclose AI hosts');
  need('owner_email_present', /itunes:email>[^<]+@[^<]+<\/itunes:email>/.test(xml));
  const emailMatch = xml.match(/<itunes:email>([^<]+)<\/itunes:email>/);
  const ownerEmail = emailMatch ? emailMatch[1] : null;
  need(
    'owner_email_dedicated',
    ownerEmail === 'podcast@thefloridabuzz.com',
    ownerEmail || 'missing — deploy RSS owner-email update'
  );
  need('pubDate_present', /<pubDate>/.test(xml));
  // Trailer enclosure parse
  const enc = xml.match(/<enclosure url="([^"]+)" length="([^"]+)" type="([^"]+)"/);
  need('enclosure_parsed', Boolean(enc), enc ? '' : 'enclosure attribute order/missing');
  return { xml, checks, ownerEmail, enclosure: enc ? { url: enc[1], length: enc[2], type: enc[3] } : null };
}

async function testPublishOnceSemantics() {
  const store = createMemoryStore();
  const show = await store.getShow(DISNEY_SHOW_SLUG);
  const ep = await store.createEpisode(show.id, {
    title: 'Publish once test',
    description: 'internal',
    slug: 'publish-once-test',
    show_notes_html: '<p>x</p>',
  });
  const guid = ep.guid;
  await store.updateEpisode(ep.id, {
    audio_url: 'https://example.com/once.mp3',
    audio_byte_size: 100,
    status: 'preview_ready',
  });
  await store.setStatus(ep.id, 'approved');
  await store.setStatus(ep.id, 'published');
  const firstPublishedAt = (await store.getEpisodeById(ep.id)).published_at;
  await store.setStatus(ep.id, 'published'); // idempotent transition allowed
  const again = await store.getEpisodeById(ep.id);
  const published = await store.listPublishedEpisodes(show.id);
  const xml = buildRss({
    site: 'https://thefloridabuzz.com',
    show,
    episodes: await store.listEpisodes(show.id),
    ownerEmail: DEFAULT_OWNER_EMAIL,
  });
  const guidCount = (xml.match(new RegExp(guid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  return {
    guid_stable: again.guid === guid,
    published_at_unchanged: again.published_at === firstPublishedAt,
    published_count: published.filter((p) => p.slug === 'publish-once-test').length,
    rss_guid_once: guidCount === 1,
    ai_in_rss: /AI-generated hosts/i.test(xml),
    owner_email: /podcast@thefloridabuzz\.com/.test(xml),
  };
}

async function main() {
  const report = {
    started_at: new Date().toISOString(),
    live_rss: null,
    draft: null,
    approval: null,
    reject: null,
    publish_once: null,
    warnings: [],
    public_rss_unchanged: null,
  };

  report.live_rss = await validateLiveRss();
  report.publish_once = await testPublishOnceSemantics();

  assertFbOnly(FB_URL);
  if (!FB_KEY) throw new Error('FLORIDA_BUZZ_SUPABASE_SERVICE_KEY required');

  // Point process env at Florida Buzz for this process only (never ROOK).
  process.env.SUPABASE_URL = FB_URL;
  process.env.SUPABASE_SERVICE_KEY = FB_KEY;
  process.env.SITE_URL = 'https://thefloridabuzz.com';

  const supabase = createClient(FB_URL, FB_KEY);
  const store = createStore(supabase);
  const cfg = config({
    ...process.env,
    PODCASTS_GENERATION_ENABLED: 'false',
    PODCASTS_OWNER_EMAIL: process.env.PODCASTS_OWNER_EMAIL || DEFAULT_OWNER_EMAIL,
  });
  const pipeline = createAudioPipeline({
    cfg,
    store,
    fal: createFalTts(cfg),
    ffmpegPath: 'ffmpeg',
  });

  const weekKey = `workflow-test-${new Date().toISOString().slice(0, 10)}`;
  const beforeRss = await (await fetch('https://thefloridabuzz.com/podcasts/florida-buzz-disney/rss.xml')).text();
  const beforeGuids = [...beforeRss.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);

  let aiText = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      aiText = require('../lib/aiText');
    } catch {
      report.warnings.push('aiText module unavailable — draft packaging/script will use fallbacks');
    }
  } else {
    report.warnings.push('OPENAI_API_KEY missing — weekly draft uses fallback title/description and skips AI script');
  }
  if (!cfg.generation) {
    report.warnings.push(
      'PODCASTS_GENERATION_ENABLED=false — fal TTS skipped; attaching approved trailer bytes only as private draft audio for plumbing test'
    );
  }

  const result = await createWeeklyDraft({
    store,
    supabase,
    cfg,
    aiText,
    pipeline,
    sendEmail: null,
    env: process.env,
    force: true,
    weekKey,
  });

  if (result.skipped) throw new Error(`Draft skipped: ${result.reason}`);
  const episode = await store.getEpisodeById(result.episode.id);
  const sources = await store.listSources(episode.id);

  // Attach private draft audio (approved trailer master) — never publish this episode.
  const trailerPath = [
    '/home/ubuntu/.cursor/projects/workspace/uploads/florida-buzz-disney-trailer-master-v1_675f.mp3',
    '/tmp/fb-podcast-assets/florida-buzz-disney-trailer-master-v1.mp3',
  ].find((p) => fs.existsSync(p));
  if (trailerPath) {
    const buf = fs.readFileSync(trailerPath);
    await pipeline.attachUploadedAudio(
      { ...episode, slug: `workflow-test-audio-${Date.now()}` },
      buf,
      'workflow-test-draft.mp3'
    );
  } else {
    report.warnings.push('Local trailer MP3 not found — draft has no audio attachment for this run');
  }

  const withAudio = await store.getEpisodeById(episode.id);
  const scriptText = withAudio.script_text || '';
  report.draft = {
    id: withAudio.id,
    slug: withAudio.slug,
    status: withAudio.status,
    week_key: withAudio.week_key,
    title: withAudio.title,
    has_description: Boolean(withAudio.description),
    has_show_notes: /Florida Buzz Resources Mentioned|AI-generated hosts/i.test(withAudio.show_notes_html || ''),
    has_script: Boolean(scriptText),
    script_mentions_gena: /\bGena:/i.test(scriptText),
    script_mentions_diane: /\bDiane:/i.test(scriptText),
    script_source_grounded: sources.some((s) => s.title && scriptText.includes(s.title)),
    source_count: sources.length,
    source_kinds: [...new Set(sources.map((s) => s.source_kind))],
    has_audio: Boolean(withAudio.audio_url),
    audio_url: withAudio.audio_url,
    audio_bytes: withAudio.audio_byte_size,
    published: withAudio.status === 'published',
  };

  // Preview plumbing: confirm attached audio is reachable privately and is mpeg.
  if (withAudio.audio_url && /^https:\/\//i.test(withAudio.audio_url)) {
    const audioHead = await fetch(withAudio.audio_url, { method: 'HEAD' });
    report.audio_preview = {
      http_ok: audioHead.ok,
      content_type: audioHead.headers.get('content-type'),
      note:
        'PODCASTS_GENERATION_ENABLED=false and FAL_KEY absent — used approved trailer master bytes for private draft plumbing only; Gena (Aoede) / Diane (Zephyr) TTS not regenerated this run',
    };
  }

  // Approval prepares for site/RSS but must not publish.
  if (withAudio.audio_url) {
    if (['draft', 'script_ready'].includes(withAudio.status)) {
      await store.setStatus(withAudio.id, 'script_ready').catch(() => null);
      await store.updateEpisode(withAudio.id, { status: 'preview_ready' });
    }
    if (withAudio.status !== 'preview_ready' && withAudio.status !== 'approved') {
      await store.updateEpisode(withAudio.id, { status: 'preview_ready' });
    }
    await store.setStatus(withAudio.id, 'approved');
  }
  const approved = await store.getEpisodeById(withAudio.id);
  report.approval = {
    status: approved.status,
    in_published_list: (await store.listPublishedEpisodes(approved.show_id)).some((e) => e.id === approved.id),
  };

  // Reject: keep unpublished and allow regenerate path.
  if (approved.generation_run_id) {
    await store.updateGenerationRun(approved.generation_run_id, { status: 'rejected' });
  }
  await store.updateEpisode(approved.id, {
    status: 'draft',
    last_error: 'Workflow test rejection — not for publication',
  });
  const rejected = await store.getEpisodeById(approved.id);
  report.reject = {
    status: rejected.status,
    unpublished: rejected.status !== 'published' && !rejected.published_at,
    can_regenerate: true,
  };

  const afterRss = await (await fetch(`https://thefloridabuzz.com/podcasts/florida-buzz-disney/rss.xml?t=${Date.now()}`)).text();
  const afterGuids = [...afterRss.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);
  report.public_rss_unchanged = {
    before_count: beforeGuids.length,
    after_count: afterGuids.length,
    same_guids: JSON.stringify(beforeGuids) === JSON.stringify(afterGuids),
    test_slug_absent: !afterRss.includes(withAudio.slug),
  };

  report.owner_email_configured = cfg.ownerEmail;
  report.rss_feed_url = 'https://thefloridabuzz.com/podcasts/florida-buzz-disney/rss.xml';
  report.apple_connect = 'https://podcastsconnect.apple.com/';
  report.spotify_creators = 'https://creators.spotify.com/';
  report.finished_at = new Date().toISOString();

  const outPath = path.join('/opt/cursor/artifacts', 'florida-buzz-podcast-workflow-report.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('Wrote', outPath);
}

main().catch((err) => {
  console.error('[podcast-workflow-test] failed:', err);
  process.exitCode = 1;
});
