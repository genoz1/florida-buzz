'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { config: loadConfig, DEFAULT_ELEVEN_VOICE_GENO } = require('./config');
const { synthesizeElevenV4 } = require('./elevenTts');
const {
  audioDuration,
  writeAss,
  kenBurnsClip,
  concatVideos,
  muxAssAndAudio,
} = require('./ffmpeg');
const { getStory, LIGHTNING_LANE_WORTH_IT } = require('./stories');
const { generateOverlayAssets, lightningLaneOverlayPlan } = require('./overlays');

/**
 * Create a Florida Buzz visual news short:
 * - ElevenLabs eleven_v4 voiceover (direct API; never fal) — default Geno voice
 * - Local ffmpeg Ken Burns stills + kinetic ASS captions + brand overlays
 * - Optional premium price callout when story.moneyOverlays (no sticker dump)
 * - No AI presenter
 *
 * @param {object} options
 * @param {string} [options.storyId='lightning-lane-worth-it']
 * @param {object} [options.story] full story override
 * @param {string} [options.outDir='/opt/cursor/artifacts']
 * @param {string} [options.tmpDir]
 * @param {string} [options.outputName]
 * @param {string} [options.voicePath] reuse existing mp3 (skips TTS)
 * @param {object} [options.env]
 * @param {typeof fetch} [options.fetcher]
 */
async function createFloridaBuzzVisualVideo(options = {}) {
  const cfg = loadConfig(options.env || process.env);
  const story = options.story || getStory(options.storyId || LIGHTNING_LANE_WORTH_IT.id);

  if (story.presenter) {
    throw new Error('Visual news pipeline rejects AI presenters (story.presenter must be false)');
  }

  const outDir = options.outDir || process.env.SAMPLE_OUT_DIR || '/opt/cursor/artifacts';
  const tmpDir =
    options.tmpDir ||
    process.env.SAMPLE_TMP_DIR ||
    path.join('/tmp', `fb-visual-news-${story.id}`);
  const outputName = options.outputName || `${story.id}-visual-news.mp4`;
  const master = path.join(outDir, outputName);
  const readmePath = path.join(outDir, outputName.replace(/\.mp4$/i, '.md'));

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const still of story.stills) {
    const p = still.path || path.join(require('./stories').REFS, still.file);
    if (!fs.existsSync(p)) throw new Error(`Missing still: ${still.file || p}`);
    still.path = p;
  }

  const voiceMp3 = path.join(tmpDir, 'voice.mp3');
  let ttsMeta = { reused: false, model: cfg.elevenModel, provider: 'elevenlabs-direct' };

  if (options.voicePath && fs.existsSync(options.voicePath)) {
    fs.copyFileSync(options.voicePath, voiceMp3);
    ttsMeta = { reused: true, model: 'prebaked', provider: 'local-file' };
  } else {
    if (!cfg.elevenApiKey) {
      throw new Error('Missing ELEVENLABS_API_KEY (visual news does not use FAL_KEY)');
    }
    const result = await synthesizeElevenV4({
      apiKey: cfg.elevenApiKey,
      voiceId: cfg.elevenVoiceId,
      modelId: cfg.elevenModel,
      text: story.spoken,
      outputFormat: cfg.elevenOutputFormat,
      fetcher: options.fetcher || fetch,
    });
    fs.writeFileSync(voiceMp3, result.buffer);
    ttsMeta = {
      reused: false,
      model: result.model,
      voiceId: result.voiceId,
      voiceName: cfg.elevenVoiceId === DEFAULT_ELEVEN_VOICE_GENO ? 'Geno' : null,
      provider: result.provider,
      requestId: result.requestId,
    };
  }

  const rawDuration = audioDuration(voiceMp3) + 0.35;
  const duration = Math.min(Math.max(rawDuration, cfg.minDurationS), cfg.maxDurationS);
  const captions = (story.captions || []).map((c, i, arr) => {
    if (i !== arr.length - 1) return c;
    // Hold last caption until the CTA overlay window.
    return { ...c, end: Math.max(c.start + 0.4, duration - 3.3) };
  });

  const assPath = path.join(tmpDir, 'captions.ass');
  writeAss({
    captions,
    duration,
    outPath: assPath,
    brand: cfg.brand,
    location: story.location || '',
    width: cfg.width,
    height: cfg.height,
    ctaEndText: story.ctaCaption || 'Follow Florida Buzz',
    accents: story.accents || [],
  });

  let overlays = [];
  if (story.moneyOverlays !== false && (story.moneyOverlays || story.id === LIGHTNING_LANE_WORTH_IT.id)) {
    const overlayDir = path.join(tmpDir, 'overlays');
    const assets = generateOverlayAssets(overlayDir);
    overlays = lightningLaneOverlayPlan(assets).filter((o) => o.start < duration);
  }

  const totalFrames = Math.round(duration * cfg.fps);
  const weights = story.stills.map((s) => s.weight || 1 / story.stills.length);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  const clips = [];

  for (let i = 0; i < story.stills.length; i++) {
    const still = story.stills[i];
    const frames =
      i === story.stills.length - 1
        ? totalFrames - allocated
        : Math.max(1, Math.floor((totalFrames * weights[i]) / weightSum));
    allocated += frames;
    const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
    kenBurnsClip({
      input: still.path,
      output: clipPath,
      frames,
      zoomEnd: still.zoomEnd || 1.12,
      width: cfg.width,
      height: cfg.height,
      fps: cfg.fps,
      pan: still.pan || (i % 2 === 0 ? 'right' : 'left'),
    });
    clips.push(clipPath);
  }

  const concatList = path.join(tmpDir, 'concat.txt');
  fs.writeFileSync(concatList, clips.map((c) => `file '${c}'`).join('\n'));
  const videoOnly = path.join(tmpDir, 'video-only.mp4');
  concatVideos(concatList, videoOnly);
  muxAssAndAudio({
    videoPath: videoOnly,
    audioPath: voiceMp3,
    assPath,
    outputPath: master,
    overlays,
    duration,
  });

  const credits = [...new Set(story.stills.map((s) => `- ${s.credit || s.file}`))].join('\n');
  const voiceLine =
    ttsMeta.voiceId || cfg.elevenVoiceId
      ? `**Voice:** Geno (\`${ttsMeta.voiceId || cfg.elevenVoiceId}\`) — ElevenLabs direct`
      : '**Voice:** Geno (reused local ElevenLabs mp3; voice id bg7PC2IzyIDwYgytMiW1)';
  const overlayDesc = overlays.length
    ? 'brand pill + single premium $229 callout (no wallet/$$$$ stickers)'
    : 'none';
  fs.writeFileSync(
    readmePath,
    `# ${story.title}

**Pipeline:** ElevenLabs \`${ttsMeta.model}\` (direct API) + local ffmpeg  
${voiceLine}  
**No fal.ai** — no FAL_KEY, no fal image/ffmpeg/ElevenLabs proxy  
**No AI presenter**  
**Overlays:** ${overlayDesc}

## Script

${story.spoken}

## Notes

${(story.notes || []).map((n) => `- ${n}`).join('\n')}

## Credits

${credits}
`
  );

  return {
    ok: true,
    master,
    readmePath,
    duration,
    storyId: story.id,
    width: cfg.width,
    height: cfg.height,
    presenter: false,
    usesFal: false,
    overlayCount: overlays.length,
    tts: ttsMeta,
  };
}

module.exports = {
  createFloridaBuzzVisualVideo,
  loadConfig,
  getStory,
  LIGHTNING_LANE_WORTH_IT,
  DEFAULT_ELEVEN_VOICE_GENO,
};
