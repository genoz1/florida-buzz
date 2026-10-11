#!/usr/bin/env node
'use strict';

/**
 * ElevenLabs v4 TTS bakeoff for Florida Buzz podcast hosts (Gena / Diane).
 *
 * Uses the ElevenLabs *direct* API (not fal):
 *   POST https://api.elevenlabs.io/v1/text-to-dialogue  model_id=eleven_v4
 *
 * True multi-speaker dialogue is supported on v4 via Text to Dialogue.
 * eleven_v4_turbo is for the realtime WebSocket path — not used here.
 *
 * Required:
 *   ELEVENLABS_API_KEY
 *
 * Optional:
 *   ELEVENLABS_VOICE_GENA   — voice_id (default: Sarah premade)
 *   ELEVENLABS_VOICE_DIANE  — voice_id (default: Matilda premade)
 *   ELEVENLABS_MODEL_ID     — default eleven_v4 (dialogue HTTP)
 *   BAKEOFF_OUT_DIR         — default /opt/cursor/artifacts then /tmp/fb-tts-bakeoff/out
 *   FAL_KEY                 — if set, also generate fal Gemini A/B clip
 *   SKIP_FAL=1              — skip optional fal A/B even if FAL_KEY is set
 *
 * Usage:
 *   ELEVENLABS_API_KEY=sk_... node scripts/podcast-tts-bakeoff-eleven.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { createFalTts } = require('../lib/podcasts/falTts');
const { config } = require('../lib/podcasts/config');

// Premade library defaults (placeholders until user picks mom voices in the UI).
// Sarah = soft/warm American; Matilda = warm/friendly — contrast starting point only.
const DEFAULT_VOICE_GENA = 'EXAVITQu4vr4xnSDxMaL'; // Sarah
const DEFAULT_VOICE_DIANE = 'XrExE9yKIg1WjnnlVkGX'; // Matilda
const DEFAULT_MODEL = 'eleven_v4';
const DIALOGUE_URL = 'https://api.elevenlabs.io/v1/text-to-dialogue';
// Docs: keep total input text ≤ ~2000 chars per dialogue request for reliability.
const MAX_DIALOGUE_CHARS = 2000;

/**
 * ~2 minute named-intro bakeoff script (same open shape as production prompts).
 * Kept under 2000 chars so a single eleven_v4 dialogue request works.
 */
const BAKEOFF_SCRIPT = [
  { speaker: 'Gena', text: "[warm, bright] Hi, I'm Gena." },
  { speaker: 'Diane', text: "[friendly, grounded] And I'm Diane." },
  {
    speaker: 'Gena',
    text: "[excited] And together — welcome to Florida Buzz: Disney.",
  },
  {
    speaker: 'Gena',
    text: "[curious] So Diane, how was your week?",
  },
  {
    speaker: 'Diane',
    text: "[exhale, wry] Honestly? It rained like crazy, but otherwise we survived. Kids were fine, just soggy.",
  },
  {
    speaker: 'Gena',
    text: "[relating] Same. It rained like four days straight over here. Geno and I kept canceling little park runs.",
  },
  {
    speaker: 'Diane',
    text: "[bridging] Right — and when the weather flips like that, parade plans get messy. We almost burned Magic Kingdom tickets last week just waiting it out.",
  },
  {
    speaker: 'Gena',
    text: "[big reaction] THAT'S CRAZY.",
  },
  {
    speaker: 'Diane',
    text: "[quick] REALLY? I know.",
  },
  {
    speaker: 'Gena',
    text: "[softer] Soft plug — The Florida Buzz dot com is where we check the planning guides before we drag everyone out there.",
  },
  {
    speaker: 'Diane',
    text: "[agenda] Okay — what else is on the agenda today?",
  },
  {
    speaker: 'Gena',
    text: "[lead, conversational] First up: resort hopping without losing your mind. I keep seeing people treat Disney Springs like a free day, then wonder why the kids melt by dinner.",
  },
  {
    speaker: 'Diane',
    text: "[support] Yep. Classic.",
  },
  {
    speaker: 'Gena',
    text: "[continuing] If you're local-ish, do one focused stop — maybe a hotel lounge snack, one shop, Skyliner loop — then get out. Don't try to \"see everything\" between nap and bedtime.",
  },
  {
    speaker: 'Diane',
    text: "[agreeing, firmer] Heck yeah. Michael always wants one more loop. I'm like, no — we already won.",
  },
  {
    speaker: 'Gena',
    text: "[laughing] Exactly. And this is an unofficial fan podcast — not affiliated with, endorsed by, or sponsored by The Walt Disney Company.",
  },
  {
    speaker: 'Diane',
    text: "[warm close] We'll keep it real: parks, planning, and the stuff we actually use on The Florida Buzz. Thanks for hanging with us.",
  },
  {
    speaker: 'Gena',
    text: "[bright close] Catch you next time — and check The Florida Buzz dot com if you need a day planner or dining ideas before you go.",
  },
].map((line) => ({
  ...line,
  text: line.text.trim(),
}));

function resolveOutDir() {
  const preferred = process.env.BAKEOFF_OUT_DIR;
  if (preferred) {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  }
  for (const candidate of ['/opt/cursor/artifacts', '/tmp/fb-tts-bakeoff/out']) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      /* try next */
    }
  }
  const fallback = path.join(process.cwd(), 'tmp', 'fb-tts-bakeoff', 'out');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

function scriptAsPrompt() {
  return BAKEOFF_SCRIPT.map((l) => `${l.speaker}: ${l.text.replace(/^\[[^\]]+\]\s*/, '')}`).join('\n');
}

function dialogueInputs(voiceGena, voiceDiane) {
  return BAKEOFF_SCRIPT.map((line) => ({
    text: line.text,
    voice_id: line.speaker === 'Gena' ? voiceGena : voiceDiane,
  }));
}

function totalChars(inputs) {
  return inputs.reduce((n, i) => n + String(i.text || '').length, 0);
}

function chunkInputs(inputs, maxChars = MAX_DIALOGUE_CHARS) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const item of inputs) {
    const len = String(item.text || '').length;
    if (current.length && chars + len > maxChars) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function elevenDialogue({ apiKey, modelId, inputs, outputPath }) {
  const res = await fetch(`${DIALOGUE_URL}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      model_id: modelId,
      inputs,
      language_code: 'en',
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`ElevenLabs dialogue ${res.status}: ${detail.slice(0, 600)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('ElevenLabs returned empty audio');
  fs.writeFileSync(outputPath, buf);
  return { bytes: buf.length, requestId: res.headers.get('request-id') || null };
}

async function elevenDialogueChunked({ apiKey, modelId, inputs, outDir, stamp }) {
  const chunks = chunkInputs(inputs);
  const parts = [];
  let previousRequestIds = [];

  for (let i = 0; i < chunks.length; i++) {
    const partPath = path.join(outDir, `eleven-v4-dialogue-part${i + 1}-${stamp}.mp3`);
    const body = {
      model_id: modelId,
      inputs: chunks[i],
      language_code: 'en',
    };
    if (previousRequestIds.length) {
      body.previous_request_ids = previousRequestIds.slice(-3);
    }

    const res = await fetch(`${DIALOGUE_URL}?output_format=mp3_44100_128`, {
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
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(`ElevenLabs dialogue chunk ${i + 1}/${chunks.length} ${res.status}: ${detail.slice(0, 600)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error(`Empty audio on dialogue chunk ${i + 1}`);
    fs.writeFileSync(partPath, buf);
    parts.push(partPath);
    const rid = res.headers.get('request-id');
    if (rid) previousRequestIds.push(rid);
  }

  // Concatenate MP3 parts with simple binary join (works for same-bitrate MPEG frames).
  const merged = path.join(outDir, `eleven-v4-dialogue-${stamp}.mp3`);
  fs.writeFileSync(merged, Buffer.concat(parts.map((p) => fs.readFileSync(p))));
  return { path: merged, parts, chunks: chunks.length };
}

async function optionalFalClip(outDir, stamp) {
  if (process.env.SKIP_FAL === '1') return null;
  if (!process.env.FAL_KEY) return null;

  const cfg = config({
    ...process.env,
    PODCASTS_GENERATION_ENABLED: 'true',
  });
  const fal = createFalTts(cfg);
  const prompt = scriptAsPrompt();
  const job = await fal.submit(prompt);

  let status;
  for (let i = 0; i < cfg.falPollAttempts; i++) {
    status = await fal.status(job);
    if (status.status === 'COMPLETED') break;
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`fal TTS failed: ${JSON.stringify(status).slice(0, 400)}`);
    }
    await new Promise((r) => setTimeout(r, cfg.falPollIntervalMs));
  }
  if (!status || status.status !== 'COMPLETED') {
    throw new Error('fal TTS timed out waiting for COMPLETED');
  }

  const result = await fal.result(job);
  const audioUrl =
    result?.audio?.url ||
    result?.audio_url ||
    result?.audio?.file?.url ||
    (Array.isArray(result?.audio) ? result.audio[0]?.url : null);
  if (!audioUrl) throw new Error(`fal result missing audio URL: ${JSON.stringify(result).slice(0, 400)}`);

  const buf = await fal.downloadAudio(audioUrl);
  const outPath = path.join(outDir, `fal-gemini-dialogue-${stamp}.mp3`);
  fs.writeFileSync(outPath, buf);
  return { path: outPath, bytes: buf.length, request_id: job.request_id, model: cfg.falModel };
}

function die(msg, code = 1) {
  console.error(`\nERROR: ${msg}\n`);
  console.error('Signup → https://elevenlabs.io → Profile → API Keys → create key');
  console.error('Then:  ELEVENLABS_API_KEY=sk_... node scripts/podcast-tts-bakeoff-eleven.js');
  console.error('Optional voice IDs after you pick in Voices UI:');
  console.error('  ELEVENLABS_VOICE_GENA=<id> ELEVENLABS_VOICE_DIANE=<id>');
  process.exit(code);
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) {
    die('ELEVENLABS_API_KEY is missing. Create an ElevenLabs API key and export it (or add to secrets).');
  }

  const voiceGena = process.env.ELEVENLABS_VOICE_GENA || DEFAULT_VOICE_GENA;
  const voiceDiane = process.env.ELEVENLABS_VOICE_DIANE || DEFAULT_VOICE_DIANE;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;
  const outDir = resolveOutDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const inputs = dialogueInputs(voiceGena, voiceDiane);
  const chars = totalChars(inputs);
  const spokenPrompt = scriptAsPrompt();

  console.log('ElevenLabs v4 dialogue bakeoff');
  console.log(`  model_id:     ${modelId}`);
  console.log(`  voice Gena:   ${voiceGena}`);
  console.log(`  voice Diane:  ${voiceDiane}`);
  console.log(`  script chars: ${chars} (limit ~${MAX_DIALOGUE_CHARS} per request)`);
  console.log(`  out dir:      ${outDir}`);
  console.log('');
  console.log('--- script ---');
  console.log(spokenPrompt);
  console.log('--------------\n');

  const report = {
    started_at: new Date().toISOString(),
    model_id: modelId,
    voice_gena: voiceGena,
    voice_diane: voiceDiane,
    script_chars: chars,
    out_dir: outDir,
    eleven: null,
    fal: null,
    notes: [
      'eleven_v4 supports true multi-speaker via POST /v1/text-to-dialogue (direct API, not fal).',
      'eleven_v4_turbo is for Text-to-Dialogue WebSocket realtime — bakeoff uses HTTP eleven_v4.',
      'API default model_id is still eleven_v3; we explicitly request eleven_v4.',
    ],
  };

  let elevenPath;
  if (chars <= MAX_DIALOGUE_CHARS) {
    elevenPath = path.join(outDir, `eleven-v4-dialogue-${stamp}.mp3`);
    const result = await elevenDialogue({ apiKey, modelId, inputs, outputPath: elevenPath });
    report.eleven = { path: elevenPath, ...result, chunks: 1 };
  } else {
    const result = await elevenDialogueChunked({ apiKey, modelId, inputs, outDir, stamp });
    elevenPath = result.path;
    report.eleven = result;
  }
  console.log(`Wrote ElevenLabs clip: ${elevenPath} (${fs.statSync(elevenPath).size} bytes)`);

  try {
    report.fal = await optionalFalClip(outDir, stamp);
    if (report.fal) console.log(`Wrote fal Gemini A/B clip: ${report.fal.path}`);
    else console.log('Skipped fal A/B (no FAL_KEY or SKIP_FAL=1).');
  } catch (err) {
    report.fal = { error: String(err.message || err) };
    console.warn(`fal A/B failed (ElevenLabs clip still ok): ${err.message || err}`);
  }

  const reportPath = path.join(outDir, `bakeoff-report-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Wrote report: ${reportPath}`);
  console.log('\nDone. Listen to the ElevenLabs MP3 and compare voices/pacing.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
