'use strict';

/**
 * Inexpensive Disney / theme-park Reel path for Facebook discovery.
 *
 * NOT the fal Seedance guide-reels pipeline. Uses article/park still photos
 * with a slow zoom/pan (cover-crop + setsar=1 → true 720x1280 / 9:16 even when
 * the article still is landscape), Geno ElevenLabs VO (eleven_v4), and kinetic
 * captions aligned to the spoken script. No AI presenter / green screen / fal.
 * Publishes via Meta /video_reels (not letterboxing Page /videos).
 *
 * Status: daily cron is wired in server.js when FB_PARK_REEL_ENABLED=true
 * (plus FB + Supabase credentials). Actual Meta posting also needs
 * FB_PARK_REEL_PUBLISH=true and a publicly reachable HTTPS MP4 URL.
 *
 * Env:
 *   FB_PARK_REEL_ENABLED=true          schedule daily 10:15am ET runner
 *   FB_PARK_REEL_PUBLISH=true          actually call Facebook video API
 *   FB_PARK_REEL_WITH_VOICE=false      disable VO (default: on when key set)
 *   ELEVENLABS_API_KEY                 Geno VO via visualNews/elevenTts
 *   PODCASTS_ELEVEN_VOICE_GENO         optional override (default Geno clone)
 *   SITE_URL                           used to build public /reels/daily URL
 *   FB_PARK_REEL_OUT_DIR               default public/reels/daily
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isFacebookTopicAllowed } = require('./facebookDistribution');
const { postToFacebookPage } = require('./facebook');
const { toFacebookFeedCaption } = require('./socialCopy');
const { synthesizeElevenV4 } = require('./visualNews/elevenTts');
const {
  config: visualNewsConfig,
  DEFAULT_ELEVEN_VOICE_GENO,
} = require('./visualNews/config');

const ROOT = path.join(__dirname, '..');

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

function ffprobeBin() {
  try {
    return require('ffprobe-static').path;
  } catch {
    return 'ffprobe';
  }
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegBin(), args, {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || '').slice(-1200)}`);
  }
  return result.stdout;
}

function runFfprobe(args) {
  const result = spawnSync(ffprobeBin(), args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`ffprobe failed: ${(result.stderr || result.stdout || '').slice(-800)}`);
  }
  return result.stdout;
}

function audioDuration(file) {
  const n = Number(
    runFfprobe([
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]).trim()
  );
  if (!Number.isFinite(n) || n <= 0) throw new Error('Invalid audio duration');
  return n;
}

function stamp(seconds) {
  const c = Math.round(seconds * 100);
  const h = Math.floor(c / 360000);
  const m = Math.floor(c / 6000) % 60;
  const s = Math.floor(c / 100) % 60;
  const cs = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Voice is on by default whenever an ElevenLabs key is present. */
function parkReelVoiceEnabled(env = process.env) {
  if (env.FB_PARK_REEL_WITH_VOICE === 'false' || env.FB_PARK_REEL_WITH_VOICE === '0') {
    return false;
  }
  return Boolean(env.ELEVENLABS_API_KEY || env.XI_API_KEY);
}

function stripAudioTags(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenScriptFromArticle(article) {
  if (article?.spoken) return String(article.spoken).trim();
  const title = String(article?.title || 'Florida theme parks').trim();
  const dek = String(article?.dek || '').trim();
  const tip = dek || 'Worth knowing before your next park day.';
  return `[curious] ${title}. ${tip} [upbeat] Follow Florida Buzz.`;
}

/**
 * Wrap caption copy into short ASS lines (no mid-sentence ellipsis).
 * Prefer more kinetic beats over truncating words Gene actually speaks.
 */
function formatCaptionLines(text, { maxLine = 22, maxLines = 2 } = {}) {
  const words = String(text || '')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return 'Florida Buzz';

  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxLine) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = word.length > maxLine ? `${word.slice(0, maxLine - 1)}…` : word;
    if (lines.length >= maxLines) {
      cur = '';
      break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.join('\\N') || 'Florida Buzz';
}

/** Split a long spoken fragment into beat-sized chunks at word boundaries. */
function splitCaptionChunk(text, maxChars = 40) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  const words = t.split(/\s+/);
  const chunks = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) chunks.push(cur);
      cur = word;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Split spoken copy into kinetic caption beats and scale them to audio duration.
 * Caption text matches what Geno says (audio tags stripped).
 */
function captionBeatsFromSpoken(spoken, durationSec) {
  const plain = stripAudioTags(spoken);
  let parts = plain
    .split(/(?<=[.!?…])\s+|\s+[—–]\s+|\s+So\.\.\.\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  // Keep Reels readable: merge tiny fragments, split long ones at words (no "…").
  const normalized = [];
  for (const part of parts) {
    if (normalized.length && (part.length < 12 || normalized[normalized.length - 1].length < 18)) {
      normalized[normalized.length - 1] = `${normalized[normalized.length - 1]} ${part}`.trim();
    } else {
      normalized.push(...splitCaptionChunk(part, 40));
    }
  }
  parts = normalized.length ? normalized : [plain || 'Florida Buzz'];

  const weights = parts.map((p) => Math.max(p.length, 8));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const usable = Math.max(durationSec - 0.12, 1);
  let t = 0;
  return parts.map((text, i) => {
    const share = weights[i] / weightSum;
    const start = t;
    const end = i === parts.length - 1 ? usable : Math.min(usable, t + share * usable);
    t = end;
    return { start, end, text: formatCaptionLines(text) };
  });
}

/** Legacy silent-path captions (kept for tests / FB_PARK_REEL_WITH_VOICE=false). */
function captionBeatsFromArticle(article, durationSec) {
  return captionBeatsFromSpoken(spokenScriptFromArticle(article), durationSec);
}

function scaleCaptionBeats(captions, durationSec) {
  if (!Array.isArray(captions) || !captions.length) return null;
  const maxEnd = Math.max(...captions.map((c) => Number(c.end) || 0));
  if (!(maxEnd > 0)) return captions;
  const scale = (durationSec - 0.1) / maxEnd;
  return captions.map((c, i, arr) => {
    const start = Math.max(0, (Number(c.start) || 0) * scale);
    const end = i === arr.length - 1
      ? durationSec - 0.05
      : Math.max(start + 0.2, (Number(c.end) || 0) * scale);
    const raw = String(c.text || '').trim();
    // Keep explicit \\N from callers; otherwise wrap into short readable lines.
    const text = raw.includes('\\N') ? raw : formatCaptionLines(raw);
    return { ...c, start, end, text };
  });
}

function writeAss(captions, duration, outPath) {
  // Large type + thick outline for phone screens; MarginV keeps copy above FB UI.
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,68,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,1,5,3,2,48,48,290,1
Style: Brand,DejaVu Sans,34,&H00F4F7FF,&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,1,3,1,8,36,36,56,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
`;
  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    const text = String(c.text)
      .replace(/\r?\n/g, '\\N')
      .replace(/[{}]/g, ' ')
      .trim();
    ass += `Dialogue: 1,${stamp(c.start)},${stamp(end)},Caption,,0,0,0,,${text}\n`;
  }
  fs.writeFileSync(outPath, ass);
}

async function resolveStillImage(source, destPath) {
  if (!source) throw new Error('Article image is required for park Reel render');
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destPath);
    return destPath;
  }
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Could not download article image (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return destPath;
  }
  throw new Error(`Article image not found: ${source}`);
}

/**
 * Slow zoom + slight pan on a still photo → true 720x1280 (9:16).
 *
 * Cover-crop landscape/portrait stills (no letterbox/pillarbox). Force
 * setsar=1 — landscape article photos otherwise leave SAR≈256:81 / DAR=16:9
 * on a 720x1280 pixel buffer, and Facebook plays that as a letterboxed
 * landscape video (Gene's cruise Reel screenshot).
 */
function slowZoomPanStill(input, output, frames, { zoomEnd = 1.12, pan = 'up' } = {}) {
  const fps = 30;
  const panExpr = pan === 'down'
    ? `y='ih/2-(ih/zoom/2)+0.18*on'`
    : `y='ih/2-(ih/zoom/2)-0.18*on'`;
  runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', input,
    '-vf',
    // Cover into a tall work canvas, then Ken Burns → exact 720x1280 square pixels.
    `scale=900:1600:force_original_aspect_ratio=increase,crop=900:1600,zoompan=z='min(1+0.0012*on,${zoomEnd})':x='iw/2-(iw/zoom/2)':${panExpr}:d=1:s=720x1280:fps=${fps},setsar=1,setdar=9/16,format=yuv420p`,
    '-frames:v', String(frames),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-aspect', '9:16',
    output,
  ]);
}

/**
 * Synthesize Geno VO (eleven_v4) via visualNews/elevenTts — never fal.
 * Returns local mp3 path + duration. Pass voicePath to reuse a prebaked Geno file.
 */
async function synthesizeParkReelVoice({
  spoken,
  outPath,
  voicePath = null,
  env = process.env,
  fetcher = fetch,
} = {}) {
  if (voicePath) {
    if (!fs.existsSync(voicePath)) throw new Error(`voicePath not found: ${voicePath}`);
    fs.copyFileSync(voicePath, outPath);
    return {
      path: outPath,
      duration: audioDuration(outPath),
      voiceId: DEFAULT_ELEVEN_VOICE_GENO,
      model: 'prebaked',
      provider: 'local-file',
      reused: true,
    };
  }

  const cfg = visualNewsConfig(env);
  if (!cfg.elevenApiKey) {
    throw new Error('ELEVENLABS_API_KEY is required for park Reel Geno VO (or pass voicePath)');
  }

  const result = await synthesizeElevenV4({
    apiKey: cfg.elevenApiKey,
    voiceId: cfg.elevenVoiceId || DEFAULT_ELEVEN_VOICE_GENO,
    modelId: cfg.elevenModel || 'eleven_v4',
    text: spoken,
    outputFormat: cfg.elevenOutputFormat || 'mp3_44100_128',
    fetcher,
  });
  fs.writeFileSync(outPath, result.buffer);
  return {
    path: outPath,
    duration: audioDuration(outPath),
    voiceId: result.voiceId,
    model: result.model,
    provider: result.provider,
    requestId: result.requestId,
    reused: false,
  };
}

/**
 * Pick the newest theme-park / cruise article with an image that passes the
 * Facebook topic allowlist and has not already been used for a park Reel
 * (detail marker in post_log when client is provided).
 */
async function pickParkCruiseArticle(client, { limit = 40 } = {}) {
  if (!client) throw new Error('Supabase client required to pick a park Reel article');
  const { data, error } = await client
    .from('articles')
    .select('id, slug, title, dek, category, image_url, fb_caption, published_at')
    .not('image_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load articles for park Reel: ${error.message}`);

  const candidates = (data || []).filter((row) => {
    if (!row.image_url) return false;
    return isFacebookTopicAllowed({
      category: row.category,
      title: row.title,
      dek: row.dek,
      caption: row.fb_caption,
      slug: row.slug,
    }).ok;
  });

  if (!candidates.length) return null;

  try {
    const { data: logs } = await client
      .from('post_log')
      .select('detail')
      .eq('platform', 'facebook')
      .eq('status', 'success')
      .like('detail', 'park-reel:%')
      .limit(200);
    const used = new Set((logs || []).map((row) => String(row.detail || '').replace(/^park-reel:/, '')));
    const fresh = candidates.find((row) => !used.has(row.slug));
    return fresh || candidates[0];
  } catch {
    return candidates[0];
  }
}

function buildReelCaption(article) {
  const base = toFacebookFeedCaption(
    article.fb_caption || `${article.title}. ${article.dek || ''}`.trim()
  );
  // Light discovery packaging — no hashtag dump.
  return `${base}\n\nPark tip from Florida Buzz — would you use this?`;
}

/**
 * Render a short vertical MP4 from park stills + Geno VO + kinetic captions.
 * Returns local paths + suggested public URL (if SITE_URL is set).
 */
async function renderParkReelFromArticle(article, {
  outDir = process.env.FB_PARK_REEL_OUT_DIR || path.join(ROOT, 'public', 'reels', 'daily'),
  tmpDir = process.env.FB_PARK_REEL_TMP_DIR || '/tmp/fb-park-reel',
  durationSec = 12,
  siteUrl = process.env.SITE_URL || 'https://thefloridabuzz.com',
  /** Optional local file paths (skip network). When 2+ stills, each gets a slow zoom/pan. */
  imagePaths = null,
  masterFileName = null,
  captions = null,
  spoken = null,
  voicePath = null,
  withVoice = null,
  env = process.env,
  fetcher = fetch,
} = {}) {
  const sources = Array.isArray(imagePaths) && imagePaths.length
    ? imagePaths
    : [article?.localImagePath || article?.image_url].filter(Boolean);
  if (!sources.length) throw new Error('Article image_url (or imagePaths) is required for park Reel render');

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const slugSafe = String(article.slug || 'park-tip').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 80);
  const assPath = path.join(tmpDir, `${slugSafe}.ass`);
  const videoOnly = path.join(tmpDir, `${slugSafe}-video.mp4`);
  const voiceMp3 = path.join(tmpDir, `${slugSafe}-voice.mp3`);
  const masterName = masterFileName || `${slugSafe}-${Date.now().toString(36)}.mp4`;
  const masterPath = path.join(outDir, masterName);

  const spokenText = String(spoken || spokenScriptFromArticle(article)).trim();
  const wantVoice = withVoice == null ? (Boolean(voicePath) || parkReelVoiceEnabled(env)) : Boolean(withVoice);

  let voiceMeta = null;
  let duration = Math.min(Math.max(Number(durationSec) || 12, 8), 28);
  if (wantVoice) {
    voiceMeta = await synthesizeParkReelVoice({
      spoken: spokenText,
      outPath: voiceMp3,
      voicePath,
      env,
      fetcher,
    });
    duration = Math.min(Math.max(voiceMeta.duration + 0.35, 8), 28);
  }

  let beats;
  if (Array.isArray(captions) && captions.length) {
    beats = scaleCaptionBeats(captions, duration) || captions;
  } else {
    beats = captionBeatsFromSpoken(spokenText, duration);
  }
  writeAss(beats, duration, assPath);

  const fps = 30;
  const totalFrames = Math.round(duration * fps);
  const baseFrames = Math.floor(totalFrames / sources.length);
  const clipPaths = [];
  let assigned = 0;
  for (let i = 0; i < sources.length; i += 1) {
    const stillPath = path.join(tmpDir, `${slugSafe}-still-${i}.jpg`);
    await resolveStillImage(sources[i], stillPath);
    const frames = i === sources.length - 1 ? totalFrames - assigned : baseFrames;
    assigned += frames;
    clipPaths.push({ stillPath, frames, index: i });
  }

  const renderedClips = [];
  for (const clip of clipPaths) {
    const clipOut = path.join(tmpDir, `${slugSafe}-clip-${clip.index}.mp4`);
    slowZoomPanStill(clip.stillPath, clipOut, clip.frames, {
      zoomEnd: clip.index % 2 === 0 ? 1.14 : 1.11,
      pan: clip.index % 2 === 0 ? 'up' : 'down',
    });
    renderedClips.push(clipOut);
  }

  if (renderedClips.length === 1) {
    fs.copyFileSync(renderedClips[0], videoOnly);
  } else {
    const concatList = path.join(tmpDir, `${slugSafe}-concat.txt`);
    fs.writeFileSync(concatList, renderedClips.map((p) => `file '${p}'`).join('\n'));
    runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', videoOnly]);
  }

  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  // Re-assert square pixels + 9:16 after ASS burn (ass filter can inherit SAR).
  const burnVf = `ass=${assEscaped},setsar=1,setdar=9/16,format=yuv420p`;
  if (wantVoice && fs.existsSync(voiceMp3)) {
    runFfmpeg([
      '-y',
      '-i', videoOnly,
      '-i', voiceMp3,
      '-vf', burnVf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-aspect', '9:16',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      masterPath,
    ]);
  } else {
    runFfmpeg([
      '-y',
      '-i', videoOnly,
      '-f', 'lavfi',
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-vf', burnVf,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-aspect', '9:16',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-t', String(duration),
      '-movflags', '+faststart',
      masterPath,
    ]);
  }

  const publicUrl = `${String(siteUrl).replace(/\/$/, '')}/reels/daily/${masterName}`;
  return {
    masterPath,
    publicUrl,
    duration,
    spoken: spokenText,
    captions: beats,
    voice: voiceMeta,
    caption: buildReelCaption(article),
    articleUrl: `${String(siteUrl).replace(/\/$/, '')}/article/${article.slug}`,
  };
}

/**
 * Publish a rendered park Reel to Facebook as a vertical Reel (video_reels API)
 * with the article link in the first comment. Falls back only if explicitly
 * disabled via FB_PARK_REEL_AS_REEL=false (legacy /videos path — letterboxes).
 * Requires FB_PARK_REEL_PUBLISH=true (or publish:true) and a reachable videoUrl.
 */
async function publishParkReel({
  article,
  videoUrl,
  caption,
  articleUrl,
  dryRun = process.env.DRY_RUN === 'true',
  publish = process.env.FB_PARK_REEL_PUBLISH === 'true',
  asReel = process.env.FB_PARK_REEL_AS_REEL !== 'false',
} = {}) {
  if (!publish && !dryRun) {
    return {
      ok: false,
      reason: 'publish_disabled',
      detail: 'Set FB_PARK_REEL_PUBLISH=true to post. Video was rendered only.',
      videoUrl,
    };
  }

  const message = caption || buildReelCaption(article);
  const link = articleUrl || `${(process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '')}/article/${article.slug}`;

  const result = await postToFacebookPage({
    message,
    link,
    videoUrl,
    dryRun: dryRun || !publish,
    linkPlacement: 'first_comment',
    linkCommentKind: 'article',
    logDetail: `park-reel:${article.slug}`,
    returnResult: true,
    asReel,
    reelTitle: String(article?.title || 'Florida Buzz').slice(0, 255),
  });

  return {
    ok: Boolean(result),
    result,
    videoUrl,
    message,
    link,
    asReel,
  };
}

async function runParkReelJob({
  client,
  dryRun = process.env.DRY_RUN === 'true',
  publish = process.env.FB_PARK_REEL_PUBLISH === 'true',
  article = null,
} = {}) {
  const picked = article || await pickParkCruiseArticle(client);
  if (!picked) {
    return { ok: false, reason: 'no_candidate', detail: 'No theme-park/cruise article with an image' };
  }

  console.log(`Park Reel candidate: ${picked.title} (/article/${picked.slug})`);
  const rendered = await renderParkReelFromArticle(picked);
  console.log(`Rendered: ${rendered.masterPath}`);
  console.log(`Public URL (must be reachable for Meta): ${rendered.publicUrl}`);
  if (rendered.voice) {
    console.log(`Voice: Geno ${rendered.voice.voiceId} (${rendered.voice.model})`);
  }

  const published = await publishParkReel({
    article: picked,
    videoUrl: rendered.publicUrl,
    caption: rendered.caption,
    articleUrl: rendered.articleUrl,
    dryRun,
    publish,
  });

  return {
    ok: true,
    article: { slug: picked.slug, title: picked.title, category: picked.category },
    rendered,
    published,
  };
}

function parkReelScheduleEnabled(env = process.env) {
  return env.FB_PARK_REEL_ENABLED === 'true'
    && Boolean(env.FB_PAGE_ID)
    && Boolean(env.FB_PAGE_ACCESS_TOKEN);
}

module.exports = {
  buildReelCaption,
  captionBeatsFromArticle,
  captionBeatsFromSpoken,
  formatCaptionLines,
  parkReelScheduleEnabled,
  parkReelVoiceEnabled,
  pickParkCruiseArticle,
  publishParkReel,
  renderParkReelFromArticle,
  resolveStillImage,
  runParkReelJob,
  slowZoomPanStill,
  splitCaptionChunk,
  spokenScriptFromArticle,
  stripAudioTags,
  synthesizeParkReelVoice,
};
