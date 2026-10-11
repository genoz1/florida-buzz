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

/** Solo Geno show trailer (~2–3 min spoken at natural pace). No Diane/Gena. */
const TRAILER_SCRIPT = `[excited] Welcome to Florida Buzz: Disney. I'm Geno — and this is your unofficial Walt Disney World fan podcast from The Florida Buzz.

[conversational] Quick and important up front: this show is not affiliated with, endorsed by, or sponsored by The Walt Disney Company. We're fans. Unofficial. Here for the parks, the planning, and that real family-trip energy.

[excited] So what is Florida Buzz: Disney? Every week I dig into park news, wait times, construction updates, resort tips, and practical vacation planning you can actually use on a real Disney day. Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom — the stuff that changes your morning when you're on property and trying to keep the whole crew smiling.

[conversational] The format is simple and fast. Quick hits when you need the headlines without the fluff. Then deeper takes when a story deserves more than a scroll — construction timelines, resort tradeoffs, planning moves that save you time and stress. Standalone episodes drop Tuesday and Friday, so you can catch up before the weekend or lock in midweek strategy.

[warm] If you're planning a trip — or you just love staying in the Disney World loop — this is your show. I'll keep it practical, high energy, and focused on what families actually need: where the waits are stacking, what's under construction, which resort moves make sense, and the planning tips from The Florida Buzz that help you spend less time refreshing apps and more time riding.

[excited] Want more between episodes? Hit The Florida Buzz dot com. Check the Buzz Board, pull the guides, watch the wait times, and use the planning tools that back up everything we talk about here. That's thefloridabuzz.com — your home base for park intel and trip prep.

[conversational] Follow and subscribe so you never miss a Tuesday or Friday drop. Share it with your trip group if they're the ones asking "what's new at the parks?" I'm Geno — this is Florida Buzz: Disney — unofficial, fan-powered, and ready when you are. Let's go.`;

const NEW_DESCRIPTION =
  'Meet Geno in this short preview of Florida Buzz: Disney — an unofficial Walt Disney World fan podcast from The Florida Buzz. Weekly park news, wait times, construction, resort tips, and practical family-trip planning. Episodes Tuesday and Friday. Visit https://thefloridabuzz.com for the Buzz Board, guides, and wait times. Not affiliated with The Walt Disney Company.';

const NEW_SHOW_NOTES = `<p>Short trailer for <strong>Florida Buzz: Disney</strong> — hosted by Geno.</p>
<p>Weekly unofficial fan coverage of Walt Disney World park news, wait times, construction, resorts, and family vacation planning. Standalone episodes Tuesday and Friday.</p>
<p>Visit <a href="https://thefloridabuzz.com">thefloridabuzz.com</a> for Disney park news, planning guides, wait times, dining tips, and the Buzz Board.</p>
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

  const masterName = 'florida-buzz-disney-trailer-master-v2-solo-geno.mp3';
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
      audio_url: oldAudioUrl,
      note: 'Left in storage as backup; episode audio_url now points at v2 solo Geno master. Episode stayed published with same slug/guid so RSS itunes:episodeType=trailer swaps enclosure.',
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
    `# Florida Buzz: Disney — Solo Geno Trailer (v2)

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
- Old audio left in bucket: \`${oldAudioUrl}\`

## Script summary

Solo Geno welcome → unofficial disclosure → weekly park news / waits / construction / resort tips → Tue/Fri format → thefloridabuzz.com + Buzz Board CTA → follow/subscribe. No Diane/Gena.
`
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
