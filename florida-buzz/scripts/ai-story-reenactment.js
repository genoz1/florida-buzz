#!/usr/bin/env node
'use strict';

/**
 * Custom AI story-reenactment clips via Seedance (fal).
 * Generates 9:16 motion beats from a written story — not static images.
 *
 * Requires: FAL_KEY
 * Optional: ELEVENLABS_API_KEY to mux VO like the stock sample.
 *
 * Dry cost check only unless --generate is passed.
 *
 * Example:
 *   node scripts/ai-story-reenactment.js --generate
 */

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { createFal } = require('../lib/reels/fal');
const { SEEDANCE, videoInput } = require('../lib/reels/config');

const OUT_DIR = process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
const TMP = process.env.SAMPLE_TMP_DIR || '/tmp/fb-ai-reenact';

const STORY = {
  id: 'pool-before-rope-drop-ai',
  beats: [
    {
      id: 'hook-splash',
      seconds: 5,
      prompt:
        'Vertical 9:16 cinematic phone video. Sunny Florida resort hotel pool. A kid cannonballs into bright blue water, huge splash toward camera, parents flinching on deck chairs. Natural daylight, handheld energy, no logos, no Disney characters, no readable brand text.',
    },
    {
      id: 'scramble',
      seconds: 5,
      prompt:
        'Vertical 9:16 cinematic phone video. Same Florida resort morning. Wet family rushing across a hotel parking lot in flip-flops toward a rental car, towels half-wrapped, clock-pressure energy. Realistic, no logos, no Disney characters.',
    },
    {
      id: 'payoff',
      seconds: 5,
      prompt:
        'Vertical 9:16 cinematic phone video. Theme-park morning crowd energy at a generic colorful entrance plaza (not a real trademarked castle). Family hustling through turnstiles, relieved smiles. Soft golden light. No logos, no trademarked characters, no readable park names.',
    },
  ],
};

async function download(url, file) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !(u.hostname === 'fal.media' || u.hostname.endsWith('.fal.media'))) {
    throw new Error('Unexpected media host');
  }
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const generate = process.argv.includes('--generate');
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.log(JSON.stringify({
      ok: false,
      reason: 'FAL_KEY missing',
      note: 'Stock motion sample (scripts/story-reenactment-sample.js) works without fal. Add FAL_KEY to generate custom AI reenactment clips.',
      story: STORY.id,
      beats: STORY.beats.map((b) => ({ id: b.id, seconds: b.seconds })),
    }, null, 2));
    process.exitCode = generate ? 1 : 0;
    return;
  }

  const fal = createFal({ falKey, billingKey: process.env.FAL_BILLING_KEY || falKey });
  const balance = await fal.balance();
  let quoteTotal = 0;
  const quotes = [];
  for (const beat of STORY.beats) {
    const quote = await fal.quote(SEEDANCE, beat.seconds);
    quoteTotal += quote.amount;
    quotes.push({ id: beat.id, amount: quote.amount, unit: quote.unit });
  }

  console.log(JSON.stringify({
    ok: true,
    balance,
    quoteTotal,
    quotes,
    generate,
  }, null, 2));

  if (!generate) {
    console.log('Pass --generate to spend fal credits and render clips.');
    return;
  }

  if (quoteTotal > balance) throw new Error('Insufficient fal balance for story package');
  if (quoteTotal > Number(process.env.REELS_PACKAGE_CAP_USD || 3)) {
    throw new Error('Quote exceeds REELS_PACKAGE_CAP_USD');
  }

  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const saved = [];
  for (const beat of STORY.beats) {
    console.log(`Submitting ${beat.id}…`);
    const submitted = await fal.submit(SEEDANCE, videoInput(beat.prompt, beat.seconds));
    let result = null;
    for (let i = 0; i < 90; i += 1) {
      await new Promise((r) => setTimeout(r, 4000));
      const polled = await fal.poll(submitted);
      if (!polled) continue;
      if (polled.failed) throw new Error(`Beat ${beat.id} failed${polled.refusal ? ' (refusal)' : ''}`);
      result = polled.result;
      break;
    }
    if (!result) throw new Error(`Timed out waiting for ${beat.id}`);
    const mediaUrl = result?.video?.url || result?.data?.video?.url;
    if (!mediaUrl) {
      fs.writeFileSync(path.join(TMP, `${beat.id}.json`), JSON.stringify(result, null, 2));
      throw new Error(`No video URL for ${beat.id}; raw result saved`);
    }
    const file = path.join(OUT_DIR, `ai-reenact-${beat.id}.mp4`);
    await download(mediaUrl, file);
    saved.push({ id: beat.id, file, request_id: submitted.request_id });
    console.log(`Saved ${file}`);
  }

  console.log(JSON.stringify({ ok: true, saved }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { STORY, main };
