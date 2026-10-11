#!/usr/bin/env node
'use strict';

/**
 * Replace the published Florida Buzz: Disney RSS trailer (slug=trailer) in place
 * with a solo Geno intro trailer: announcer v7 bumper + ElevenLabs eleven_v4 Geno.
 *
 * Env:
 *   source /tmp/fb-tts-bakeoff/eleven.env
 *   source /tmp/fb-supabase.env
 *
 * Does not rewrite show hosts/description (sibling pipeline owns that).
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { DISNEY_SHOW_SLUG } = require('../lib/podcasts/config');
const { createStore } = require('../lib/podcasts/store');
const { prependAudioBuffer, encodePodcastMaster } = require('../lib/podcasts/audioPipeline');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_GENO = process.env.ELEVENLABS_VOICE_GENO || 'bg7PC2IzyIDwYgytMiW1';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const OUT_DIR = process.env.BAKEOFF_OUT_DIR || '/opt/cursor/artifacts';
const TMP_DIR = '/tmp/fb-tts-bakeoff/out';
const TRAILER_SLUG = 'trailer';
const EPISODE_ID = 'a57f3e18-1e0a-499d-b5f7-bef8346f32f0';

const INTRO_LOCAL = path.join(
  __dirname,
  '../public/podcasts/florida-buzz-park-intro-announcer-only-v7.mp3'
);

/** Solo Geno show trailer (~2–3 min). Exact user story beats. No Diane/Gena. */
const TRAILER_SCRIPT = `[warm] Hey — I'm Geno, and this is Florida Buzz: Disney.

[conversational] I've been a Disney enthusiast visiting Walt Disney World for over fifty years. My first trip? I was eighteen months old — back in nineteen seventy-four. So yeah… this place has been part of my life basically since before I could walk. I've grown up with it, gone back again and again through every era of the parks, and I still get that same spark when I'm heading through the gates. That kind of history doesn't make me an expert with a badge — it just means I've lived a lot of Disney days, good ones and crowded ones, and I know what it feels like when a trip is clicking… and when it's not.

[excited] On this show, I'm bringing you park news, guides, and other Disney-related topics — the real stuff fans want when they're planning a vacation or just staying in the loop between trips. What's new at the parks. What's changing. Which guides actually help when you're building a day. Dining ideas, resort chatter, little planning moves that save you stress. Magic Kingdom mornings, EPCOT afternoons, Hollywood Studios must-dos, Animal Kingdom adventures — I talk through it like a friend who already did the homework. Practical. Friendly. From somebody who actually lives this — not from a corporate brochure.

[conversational] This podcast is sponsored by The Florida Buzz dot com — your home base for Disney park intel, planning guides, wait times, dining tips, and more. Between episodes, that's where you'll find the tools and updates that back up everything we talk about here. Hit The Florida Buzz dot com when you want to dig deeper after you hit pause. Use it while you're packing. Use it the night before a park day. Use it when the kids ask, "what's next?"

[warm] Quick and important up front: this is an unofficial fan podcast. We are not affiliated with, endorsed by, or sponsored by The Walt Disney Company. Just fans. Real talk. Real love for the parks. That's the whole energy of Florida Buzz: Disney — fifty-plus years of visiting, and still showing up excited for the next trip.

[excited] If that sounds like your kind of show — click that button to subscribe. Don't miss an episode. Stick with me for the news, the guides, and the Disney conversation that keeps you ready for your next park day. Share it with your trip group. Hit play on a walk, in the car, or while you're packing snacks for tomorrow. Welcome to the Florida Buzz family.

[warm] I'm Geno. This is Florida Buzz: Disney. Let's go.`;

const NEW_DESCRIPTION =
  'Meet Geno in this short trailer for Florida Buzz: Disney — an unofficial Walt Disney World fan podcast. A Disney enthusiast visiting for over 50 years (first trip at 18 months old in 1974) brings park news, guides, and Disney topics. Sponsored by The Florida Buzz (thefloridabuzz.com). Not affiliated with The Walt Disney Company.';

const NEW_SHOW_NOTES = `<p>Trailer for <strong>Florida Buzz: Disney</strong> — hosted by Geno.</p>
<p>I'm Geno — a Disney enthusiast who's been visiting Walt Disney World for over 50 years. My first trip was at 18 months old in 1974. On this unofficial fan podcast I bring park news, guides, and other Disney-related topics.</p>
<p>Sponsored by <a href="https://thefloridabuzz.com">The Florida Buzz</a> (thefloridabuzz.com). Click subscribe and welcome to the Florida Buzz family.</p>
<p>This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.</p>`;

function ensureDirs() {
  for (const d of [OUT_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });
}

function wordCount(text) {
  return text
    .replace(/\[[^\]]*\]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function probeDuration(filePath) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath],
    { encoding: 'utf8' }
  );
  return parseFloat(String(probe.stdout || '').trim()) || null;
}

async function elevenTts({ apiKey, voiceId, modelId, text, outputPath }) {
  const body = {
    text,
    model_id: modelId,
    language_code: 'en',
    voice_settings: {
      stability: 0.4,
      similarity_boost: 0.75,
      style: 0.45,
      use_speaker_boost: true,
    },
  };

  const res = await fetch(`${TTS_URL}/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 400 && /voice_settings|stability|style/i.test(detail)) {
      console.warn('Retrying TTS without voice_settings...');
      const body2 = { text, model_id: modelId, language_code: 'en' };
      const res2 = await fetch(`${TTS_URL}/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body2),
        signal: AbortSignal.timeout(180000),
      });
      if (!res2.ok) {
        const d2 = await res2.text().catch(() => '');
        throw new Error(`ElevenLabs TTS ${res2.status}: ${d2.slice(0, 800)}`);
      }
      const buf2 = Buffer.from(await res2.arrayBuffer());
      if (!buf2.length) throw new Error('Empty audio');
      fs.writeFileSync(outputPath, buf2);
      return { bytes: buf2.length, requestId: res2.headers.get('request-id') || null, settings: null };
    }
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 800)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Empty audio');
  fs.writeFileSync(outputPath, buf);
  return {
    bytes: buf.length,
    requestId: res.headers.get('request-id') || null,
    settings: body.voice_settings,
  };
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  const fbUrl = process.env.FLORIDA_BUZZ_SUPABASE_URL || process.env.SUPABASE_URL;
  const fbKey = process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!apiKey) throw new Error('Missing ELEVENLABS_API_KEY');
  if (!fbUrl || !fbKey) throw new Error('Missing Florida Buzz Supabase URL/key');
  if (!fbUrl.includes('tcrfirzjcjvfmiepgbjh')) {
    throw new Error(`Refusing non-Florida-Buzz Supabase URL: ${fbUrl}`);
  }
  if (!fs.existsSync(INTRO_LOCAL)) throw new Error(`Announcer intro missing: ${INTRO_LOCAL}`);

  ensureDirs();
  const words = wordCount(TRAILER_SCRIPT);
  console.log(`Script words: ${words} (est ~${(words / 150).toFixed(1)} min spoken + ~8s bumper)`);

  const rawPath = path.join(TMP_DIR, 'solo-geno-trailer-body-raw.mp3');
  const tts = await elevenTts({
    apiKey,
    voiceId: VOICE_GENO,
    modelId: MODEL_ID,
    text: TRAILER_SCRIPT,
    outputPath: rawPath,
  });
  console.log(`TTS bytes=${tts.bytes} requestId=${tts.requestId}`);

  const introBuf = await fsp.readFile(INTRO_LOCAL);
  const bodyBuf = await fsp.readFile(rawPath);
  const withIntro = await prependAudioBuffer(introBuf, bodyBuf, 'ffmpeg');
  const master = await encodePodcastMaster(withIntro, 'ffmpeg', { bitrate: '96k', channels: 1 });

  const masterName = 'florida-buzz-disney-trailer-master-v4-solo-geno-50yr.mp3';
  const masterPath = path.join(OUT_DIR, masterName);
  const previewStereo = path.join(OUT_DIR, 'florida-buzz-disney-trailer-solo-geno-preview.mp3');
  await fsp.writeFile(masterPath, master);
  // Stereo listen copy for local preview convenience
  const stereo = spawnSync(
    'ffmpeg',
    ['-y', '-i', masterPath, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k', previewStereo],
    { encoding: 'utf8' }
  );
  if (stereo.status !== 0) throw new Error(`stereo preview encode failed: ${stereo.stderr?.slice(-400)}`);

  fs.copyFileSync(masterPath, path.join(TMP_DIR, masterName));
  fs.copyFileSync(previewStereo, path.join(TMP_DIR, path.basename(previewStereo)));

  const duration = probeDuration(masterPath);
  const durationSec = duration ? Math.round(duration) : null;
  console.log(`Master duration=${duration?.toFixed(1)}s bytes=${master.length}`);

  const transcriptPath = path.join(OUT_DIR, 'florida-buzz-disney-trailer-solo-geno.transcript.txt');
  fs.writeFileSync(transcriptPath, TRAILER_SCRIPT + '\n');

  const client = createClient(fbUrl, fbKey, { auth: { persistSession: false } });
  const store = createStore(client);
  const show = await store.getShow(DISNEY_SHOW_SLUG);
  if (!show) throw new Error('florida-buzz-disney show missing');

  const episode = await store.getEpisodeById(EPISODE_ID);
  if (!episode || episode.slug !== TRAILER_SLUG) {
    throw new Error(`Expected trailer episode ${EPISODE_ID}; got ${episode?.slug || 'missing'}`);
  }

  const oldAudioUrl = episode.audio_url;
  const checksum = crypto.createHash('sha256').update(master).digest('hex');
  const storagePath = `shows/${DISNEY_SHOW_SLUG}/trailer/${masterName}`;
  const publicUrl = await store.uploadBytes('podcast-audio', storagePath, master, 'audio/mpeg');

  const asset = await store.createAsset({
    kind: 'audio',
    storage_path: storagePath,
    public_url: publicUrl,
    content_type: 'audio/mpeg',
    byte_size: master.length,
    duration_seconds: durationSec,
    checksum,
  });

  const updated = await store.updateEpisode(episode.id, {
    title: 'Florida Buzz: Disney — Trailer',
    description: NEW_DESCRIPTION,
    show_notes_html: NEW_SHOW_NOTES,
    artwork_alt: 'Florida Buzz Disney Podcast cover — hosted by Geno',
    audio_asset_id: asset.id,
    audio_url: publicUrl,
    audio_byte_size: master.length,
    audio_content_type: 'audio/mpeg',
    duration_seconds: durationSec,
    status: 'published',
    // Keep published_at / guid stable so RSS trailer enclosure swaps in place.
    last_error: null,
    script_text: TRAILER_SCRIPT,
  });

  const report = {
    ok: true,
    action: 'replaced_trailer_in_place',
    episode: {
      id: updated.id,
      slug: updated.slug,
      status: updated.status,
      guid: updated.guid,
      published_at: updated.published_at,
      duration_seconds: updated.duration_seconds,
      audio_url: updated.audio_url,
      audio_byte_size: updated.audio_byte_size,
      audio_asset_id: updated.audio_asset_id,
    },
    old_trailer: {
      previous_audio_url: oldAudioUrl,
      sibling_v3_replaced:
        'https://tcrfirzjcjvfmiepgbjh.supabase.co/storage/v1/object/public/podcast-audio/shows/florida-buzz-disney/trailer/florida-buzz-disney-trailer-master-v3-solo-geno.mp3',
      original_dual_host_backup:
        'https://tcrfirzjcjvfmiepgbjh.supabase.co/storage/v1/object/public/podcast-audio/shows/florida-buzz-disney/trailer/florida-buzz-disney-trailer-master-v1.mp3',
      note: 'Replaces sibling solo trailer (v3) with exact 50-year story-beat master (v4). Prior masters left in storage. Episode stayed published with same slug/guid so RSS itunes:episodeType=trailer swaps the enclosure URL in place.',
    },
    production: {
      model: MODEL_ID,
      voice: VOICE_GENO,
      intro: 'florida-buzz-park-intro-announcer-only-v7.mp3',
      encode: '96k mono 44100 mp3',
      words,
      tts_request_id: tts.requestId,
      storage_path: storagePath,
    },
    listen: {
      public_audio: publicUrl,
      episode_page: `https://thefloridabuzz.com/podcasts/${DISNEY_SHOW_SLUG}/${TRAILER_SLUG}`,
      rss: `https://thefloridabuzz.com/podcasts/${DISNEY_SHOW_SLUG}/rss.xml`,
      local_preview: `http://127.0.0.1:48721/${path.basename(previewStereo)}`,
      local_master: `http://127.0.0.1:48721/${masterName}`,
    },
    artifacts: {
      master: masterPath,
      preview: previewStereo,
      transcript: transcriptPath,
    },
  };

  const reportPath = path.join(OUT_DIR, 'florida-buzz-disney-trailer-solo-geno-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, 'README-solo-geno-trailer.md'),
    `# Florida Buzz: Disney — Solo Geno Trailer (v4 / 50-year story)

Generated: ${new Date().toISOString()}  
Model: \`${MODEL_ID}\` · Voice: Geno (\`${VOICE_GENO}\`)  
Master: **${durationSec}s** · 96 kbps mono MP3 (announcer v7 + Geno body)

## Listen

- Public: ${publicUrl}
- Episode: https://thefloridabuzz.com/podcasts/${DISNEY_SHOW_SLUG}/${TRAILER_SLUG}
- Local preview: http://127.0.0.1:48721/${path.basename(previewStereo)}
- Local master: http://127.0.0.1:48721/${masterName}

## DB

- Episode id: \`${updated.id}\`
- Slug: \`${TRAILER_SLUG}\` (unchanged; RSS \`itunes:episodeType=trailer\`)
- Guid: \`${updated.guid}\` (kept stable)
- Replaced audio: \`${oldAudioUrl}\`

## Script summary

I'm Geno / Florida Buzz: Disney → 50+ years visiting WDW → first trip at 18 months in 1974 → park news, guides, Disney topics → sponsored by The Florida Buzz dot com → unofficial / not affiliated with The Walt Disney Company → click subscribe → welcome to the Florida Buzz family.
`
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
