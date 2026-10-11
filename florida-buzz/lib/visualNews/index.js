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

  const totalFrames = Math.round(duration * cfg.fps);
  const weights = story.stills.map((s) => s.weight || 1 / story.stills.length);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  const clipFrameCounts = [];
  for (let i = 0; i < story.stills.length; i++) {
    const frames =
      i === story.stills.length - 1
        ? totalFrames - allocated
        : Math.max(1, Math.floor((totalFrames * weights[i]) / weightSum));
    allocated += frames;
    clipFrameCounts.push(frames);
  }

  let captions = story.captions || [];
  if (captions.length && story.stills.length) {
    const slideEnds = [];
    let acc = 0;
    for (const f of clipFrameCounts) {
      acc += f;
      slideEnds.push(acc / cfg.fps);
    }
    const n = Math.min(captions.length, slideEnds.length);
    const aligned = [];
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const end = i === captions.length - 1 ? Math.max(slideEnds[i], duration - 3.3) : slideEnds[i];
      aligned.push({ ...captions[i], start: prev, end });
      prev = slideEnds[i];
    }
    for (let i = n; i < captions.length; i++) {
      const start = prev;
      const end =
        i === captions.length - 1
          ? Math.max(start + 0.4, duration - 3.3)
          : start + (duration - 3.3 - start) / Math.max(1, captions.length - n);
      aligned.push({ ...captions[i], start, end });
      prev = end;
    }
    captions = aligned;
  }

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
  if (story.moneyOverlays === true) {
    const overlayDir = path.join(tmpDir, 'overlays');
    const assets = generateOverlayAssets(overlayDir);
    overlays = lightningLaneOverlayPlan(assets).filter((o) => o.start < duration);
  }

  const clips = [];
  for (let i = 0; i < story.stills.length; i++) {
    const still = story.stills[i];
    const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
    kenBurnsClip({
      input: still.path,
      output: clipPath,
      frames: clipFrameCounts[i],
      zoomEnd: still.static ? 1.0 : still.zoomEnd || 1.12,
      width: cfg.width,
      height: cfg.height,
      fps: cfg.fps,
      pan: still.pan || 'center',
      static: still.static !== false,
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
      : '**Voice:** Geno (local mp3)';
  fs.writeFileSync(
    readmePath,
    `# ${story.title}

**Pipeline:** ElevenLabs \`${ttsMeta.model}\` (direct API) + local ffmpeg slideshow  
${voiceLine}  
**No fal.ai**  
**No AI presenter**  
**Format:** static full-frame stills in sequence (no stacked sticker overlays)  
**Overlays:** ${overlays.length ? `${overlays.length} PNG overlays` : 'none — captions only'}

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
    slideCount: story.stills.length,
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
