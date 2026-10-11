'use strict';

/**
 * Inexpensive Disney / theme-park Reel path for Facebook discovery.
 *
 * NOT the fal Seedance guide-reels pipeline. Uses article/park still photos
 * with a slow zoom/pan plus big on-screen text (optional ElevenLabs VO if a
 * key is present and FB_PARK_REEL_WITH_VOICE=true).
 *
 * Status: daily cron is wired in server.js when FB_PARK_REEL_ENABLED=true
 * (plus FB + Supabase credentials). Actual Meta posting also needs
 * FB_PARK_REEL_PUBLISH=true and a publicly reachable HTTPS MP4 URL.
 *
 * Env:
 *   FB_PARK_REEL_ENABLED=true          schedule daily 10:15am ET runner
 *   FB_PARK_REEL_PUBLISH=true          actually call Facebook video API
 *   FB_PARK_REEL_WITH_VOICE=true       use ElevenLabs when key is set (default off)
 *   ELEVENLABS_API_KEY                 optional VO
 *   SITE_URL                           used to build public /reels/daily URL
 *   FB_PARK_REEL_OUT_DIR               default public/reels/daily
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isFacebookTopicAllowed } = require('./facebookDistribution');
const { postToFacebookPage } = require('./facebook');
const { toFacebookFeedCaption } = require('./socialCopy');

const ROOT = path.join(__dirname, '..');

function ffmpegBin() {
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
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

function stamp(seconds) {
  const c = Math.round(seconds * 100);
  const h = Math.floor(c / 360000);
  const m = Math.floor(c / 6000) % 60;
  const s = Math.floor(c / 100) % 60;
  const cs = c % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function captionBeatsFromArticle(article, durationSec) {
  const title = String(article.title || 'Florida theme parks').trim();
  const dek = String(article.dek || '').trim();
  const hook = title.length > 42 ? `${title.slice(0, 40)}…` : title;
  const mid = dek
    ? (dek.length > 48 ? `${dek.slice(0, 46)}…` : dek)
    : 'Worth knowing before your next park day';
  const end = 'Follow Florida Buzz';
  const third = durationSec / 3;
  return [
    { start: 0, end: third, text: hook },
    { start: third, end: third * 2, text: mid },
    { start: third * 2, end: durationSec - 0.05, text: end },
  ];
}

function writeAss(captions, duration, outPath) {
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,54,&H00FFFFFF,&H00FFFFFF,&H00101010,&H8C000000,-1,0,0,0,100,100,0,0,1,3,1,2,36,36,240,1
Style: Brand,DejaVu Sans,28,&H00F4F7FF,&H00FFFFFF,&H00101010,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,8,28,28,42,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${stamp(duration)},Brand,,0,0,0,,THE FLORIDA BUZZ
`;
  for (const c of captions) {
    const end = Math.min(c.end, duration - 0.05);
    if (end <= c.start) continue;
    const text = String(c.text).replace(/[{}\\\r\n]/g, ' ');
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

/** Slow zoom + slight pan on a still photo (vertical 720x1280). */
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
    `scale=900:1600,zoompan=z='min(1+0.0012*on,${zoomEnd})':x='iw/2-(iw/zoom/2)':${panExpr}:d=1:s=720x1280:fps=${fps},format=yuv420p`,
    '-frames:v', String(frames),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    output,
  ]);
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
 * Render a short vertical MP4 from one article still + kinetic captions.
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
  const masterName = masterFileName || `${slugSafe}-${Date.now().toString(36)}.mp4`;
  const masterPath = path.join(outDir, masterName);

  const duration = Math.min(Math.max(Number(durationSec) || 12, 8), 20);
  const beats = captions || captionBeatsFromArticle(article, duration);
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
  runFfmpeg([
    '-y',
    '-i', videoOnly,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', `ass=${assEscaped},format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-t', String(duration),
    '-movflags', '+faststart',
    masterPath,
  ]);

  const publicUrl = `${String(siteUrl).replace(/\/$/, '')}/reels/daily/${masterName}`;
  return {
    masterPath,
    publicUrl,
    duration,
    caption: buildReelCaption(article),
    articleUrl: `${String(siteUrl).replace(/\/$/, '')}/article/${article.slug}`,
  };
}

/**
 * Publish a rendered park Reel to Facebook as a Page video with link in first comment.
 * Requires FB_PARK_REEL_PUBLISH=true (or publish:true) and a reachable videoUrl.
 */
async function publishParkReel({
  article,
  videoUrl,
  caption,
  articleUrl,
  dryRun = process.env.DRY_RUN === 'true',
  publish = process.env.FB_PARK_REEL_PUBLISH === 'true',
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
  });

  return {
    ok: Boolean(result),
    result,
    videoUrl,
    message,
    link,
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
  parkReelScheduleEnabled,
  pickParkCruiseArticle,
  publishParkReel,
  renderParkReelFromArticle,
  resolveStillImage,
  runParkReelJob,
  slowZoomPanStill,
};
