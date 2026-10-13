#!/usr/bin/env node
'use strict';

/**
 * One-shot sample: news-table solo Geno script + Geno11 ElevenLabs audio.
 * Uses === SEGMENT === markers so each story is synthesized separately.
 *
 * Usage (from florida-buzz/):
 *   set -a; source /tmp/fb-podcast-sample.env; set +a
 *   node scripts/podcast-news-roundup-sample.js
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { generateText } = require('../lib/aiText');
const { config } = require('../lib/podcasts/config');
const {
  generateOutline,
  generateConversation,
  splitScriptIntoSections,
  formatScriptForTts,
  countScriptWords,
} = require('../lib/podcasts/script');
const { createElevenTts } = require('../lib/podcasts/elevenTts');
const { concatMp3Buffers, applyVoicePresence, encodePodcastMaster } = require('../lib/podcasts/audioPipeline');

const OUT_DIR = process.env.PODCAST_SAMPLE_OUT || '/tmp/fb-news-roundup-sample';
const SOURCES_PATH = process.env.PODCAST_SAMPLE_SOURCES || '/tmp/fb-news-roundup-sources.json';

function loadSources() {
  const rows = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  // Disney World news podcast — prefer WDW / Disney Springs / EPCOT / Studios stories.
  const disney = rows.filter((r) => !/universal|hogwarts express/i.test(`${r.title} ${r.slug}`));
  const picked = (disney.length ? disney : rows).slice(0, 6);
  return picked.map((r) => ({
    included: true,
    title: r.title,
    url: `https://thefloridabuzz.com/article/${r.slug}`,
    summary: r.dek || r.fb_caption || '',
  }));
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const sources = loadSources();
  const show = { title: 'The Florida Buzz Disney Podcast' };
  const episode = {
    title: 'Disney World News Roundup — Nomad Lounge, Hollywood Studios & More',
    description:
      'Geno talks through what’s happening at Walt Disney World this week — Nomad Lounge changes, Galaxy’s Edge meet-and-greets, Rose & Crown closure, and more.',
    release_label: 'sample',
  };

  const aiText = { generateText };
  console.log('Generating outline…');
  const outline = await generateOutline({ aiText, show, episode, sources });
  await fsp.writeFile(path.join(OUT_DIR, 'outline.txt'), outline);

  console.log('Generating conversation script…');
  const script = await generateConversation({ aiText, show, episode, outline, sources });
  await fsp.writeFile(path.join(OUT_DIR, 'script.txt'), script);
  const words = countScriptWords(script);
  console.log(`Script words: ${words} (~${(words / 150).toFixed(1)} min at 150 wpm)`);

  const cfg = config(process.env);
  if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY missing');
  const eleven = createElevenTts(cfg);
  const sections = splitScriptIntoSections(script, cfg.sectionMaxChars);
  console.log(`TTS sections: ${sections.length}`);
  await fsp.writeFile(
    path.join(OUT_DIR, 'sections.json'),
    JSON.stringify(
      sections.map((s, i) => ({ index: i, chars: s.length, preview: formatScriptForTts(s).slice(0, 120) })),
      null,
      2
    )
  );

  const buffers = [];
  for (let i = 0; i < sections.length; i += 1) {
    const formatted = formatScriptForTts(sections[i]);
    console.log(`Synthesizing section ${i + 1}/${sections.length} (${formatted.length} chars)…`);
    const prev = i > 0 ? formatScriptForTts(sections[i - 1]) : '';
    const next = i < sections.length - 1 ? formatScriptForTts(sections[i + 1]) : '';
    // synthesize() formats Geno: prefixes itself — pass the raw section text.
    const result = await eleven.synthesize(sections[i], {
      previousText: prev,
      nextText: next,
    });
    const buf = Buffer.isBuffer(result) ? result : result.buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      throw new Error(`Empty audio for section ${i + 1}`);
    }
    const sectionPath = path.join(OUT_DIR, `section-${String(i + 1).padStart(2, '0')}.mp3`);
    await fsp.writeFile(sectionPath, buf);
    buffers.push(buf);
  }

  let ffmpegPath = 'ffmpeg';
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch {
    /* use system ffmpeg */
  }
  console.log('Concatenating…');
  let master = await concatMp3Buffers(buffers, ffmpegPath);
  if (cfg.voicePresenceFx !== false) {
    console.log('Applying presence FX…');
    master = await applyVoicePresence(master, ffmpegPath);
  } else {
    master = await encodePodcastMaster(master, ffmpegPath);
  }
  const outMp3 = path.join(OUT_DIR, 'news-roundup-geno11.mp3');
  await fsp.writeFile(outMp3, master);

  // Duration probe
  const probe = spawnSync(
    ffmpegPath,
    ['-i', outMp3, '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const durMatch = `${probe.stderr || ''}${probe.stdout || ''}`.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  let seconds = null;
  if (durMatch) {
    seconds = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
  }
  console.log(JSON.stringify({ outMp3, words, sections: sections.length, seconds }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
