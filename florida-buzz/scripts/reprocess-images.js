require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { supabase } = require('../lib/supabase');
const { imageSize } = require('image-size');

const WORKER_PATH = path.join(__dirname, 'compress-worker.js');
const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 78;

// A file's byte size doesn't tell you its decoded memory footprint — a
// modest-looking few-MB file can have huge pixel dimensions (a "dimension
// bomb") that balloons to a massive raw buffer once actually decoded,
// crashing the whole container via OOM. image-size reads just the file
// header, not the full image, so this check is cheap and safe to do before
// ever calling the heavy Jimp.read()/resize()/encode() pipeline.
const MAX_MEGAPIXELS = 12; // ~3500x3500 — two confirmed crashes tonight were both on large real-world photos (2.2MB, 5.7MB); a lower, more conservative ceiling trades a few more manual-review skips for meaningfully less risk of hitting the same container-memory wall on an unknown third file

// Small pause between images so this doesn't hammer Supabase/DigitalOcean's
// outbound bandwidth all at once across 800+ files in a tight loop.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Anything over this is worth reprocessing — a properly compressed
// 1200px-wide JPEG normally lands well under this, so a file this big means
// it's either an old uncompressed PNG or an unprocessed full-resolution real
// photo straight from a source publisher (the two things this script needs
// to catch — see lib/supabase.js for how compressForWeb() now prevents both
// going forward). Checking the real downloaded size, not the file extension,
// is what makes this catch both: an old script version only checked for a
// literal ".png" in the URL and completely missed already-".jpg" real photos
// that were simply never compressed.
const SIZE_THRESHOLD_BYTES = 150 * 1024; // 150KB

function isOwnStorageUrl(url) {
  return !!url && url.includes('/storage/v1/object/public/article-images/');
}

// Jimp genuinely cannot decode these two formats at all (confirmed earlier —
// it only bundles JPEG/PNG/GIF/BMP/TIFF support). Checking for them here,
// from just the first few bytes, means they're skipped instantly rather than
// being handed to the isolated worker at all — no process spawn, no timeout
// to wait out, nothing that can hang. This is the fast path for the large
// majority of "unsupported format" failures seen in every run so far.
function getKnownUnsupportedFormat(buffer) {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && buffer.toString('ascii', 8, 12).startsWith('avif')) {
    return 'image/avif';
  }
  return null;
}

// Prevents exactly what happened before: hitting the trigger URL again while
// a previous run is still going (e.g. right after a crash-restart) spawns a
// second, third, fourth... instance all fighting over the same CPU/memory,
// which makes an already-marginal OOM situation worse, not better. This
// lockfile makes a second run refuse to start instead of stacking up.
const LOCK_FILE = '/tmp/reprocess-images.lock';

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) return false;
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {
    // best-effort — a leftover lockfile after a hard crash is expected and
    // clears itself on the next container restart anyway, since /tmp doesn't
    // persist across restarts
  }
}

// Durable crash memory. If the whole container gets killed mid-decode (the
// exact failure mode hit repeatedly tonight), a hardcoded in-code skip list
// requires someone to read the crash log and manually add the slug, redeploy,
// and try again. This does the same thing automatically: right before the
// risky decode step for a given article, its slug is recorded here (in
// Supabase Storage — NOT local /tmp, which gets wiped on every restart, so
// this actually survives a crash). If the process dies before clearing that
// marker, the next run (even one auto-triggered by a platform restart, with
// no human involved at all) sees the leftover marker, knows that specific
// file killed the last attempt, and permanently skips it going forward.
const STATE_FILE = '_reprocess-state.json';

async function loadPersistedState() {
  try {
    const { data, error } = await supabase.storage.from('article-images').download(STATE_FILE);
    if (error || !data) return { inProgressSlug: null, confirmedProblems: [] };
    const text = await data.text();
    return JSON.parse(text);
  } catch {
    return { inProgressSlug: null, confirmedProblems: [] };
  }
}

async function savePersistedState(state) {
  try {
    await supabase.storage.from('article-images').upload(
      STATE_FILE,
      Buffer.from(JSON.stringify(state)),
      { contentType: 'application/json', upsert: true }
    );
  } catch (err) {
    console.error(`  [warning] Could not persist crash-recovery state: ${err.message}`);
  }
}

async function doRun() {
  console.log(`=== Image reprocessing run — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: no images will be downloaded, converted, or saved, no rows updated.\n');

  if (!supabase) {
    console.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing) — nothing to do.');
    return;
  }

  const persisted = await loadPersistedState();
  if (persisted.inProgressSlug) {
    console.log(`Previous run's state shows it was mid-attempt on "${persisted.inProgressSlug}" when it stopped — that's almost certainly what caused the crash. Adding it to the permanent skip list automatically.`);
    if (!persisted.confirmedProblems.includes(persisted.inProgressSlug)) {
      persisted.confirmedProblems.push(persisted.inProgressSlug);
    }
    persisted.inProgressSlug = null;
    await savePersistedState(persisted);
  }
  if (persisted.confirmedProblems.length) {
    console.log(`Auto-discovered problem files being skipped this run: ${persisted.confirmedProblems.join(', ')}`);
  }

  // Supabase caps results at 1000 rows per request by default — a plain
  // query here would silently miss everything past the first 1000 articles,
  // with no error to signal it happened. Paginating with .range() in a loop
  // fetches everything regardless of how many articles there are.
  const articles = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('articles')
      .select('id, slug, image_url')
      .order('published_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Could not load articles:', error.message);
      return;
    }
    articles.push(...page);
    if (page.length < PAGE_SIZE) break; // last page was partial — nothing more to fetch
  }

  // This specific article's image has crashed the whole process on every single
  // attempt so far, even past the dimension-bomb and NaN-dimension checks —
  // meaning whatever's actually wrong with this file isn't something those
  // generic guards catch. Rather than keep guessing at the root cause while it
  // blocks the entire run every time, skip it by name and move on. Worth
  // looking at manually later (delete and let it regenerate, or replace by hand)
  // but it should never be allowed to take down the whole job again.
  const KNOWN_PROBLEM_SLUGS = new Set([
    'legoland-florida-coastersaurus-reopening-august-16-2026',
    'visit-orlando-magical-dining-2026-restaurants-and-details',
  ]);

  const allProblemSlugs = new Set([...KNOWN_PROBLEM_SLUGS, ...persisted.confirmedProblems]);
  const candidates = articles.filter((a) => isOwnStorageUrl(a.image_url) && !allProblemSlugs.has(a.slug));
  console.log(`Found ${articles.length} articles total, ${candidates.length} with an image in our own storage to check.\n`);

  let succeeded = 0;
  let skipped = 0;
  let totalOriginalBytes = 0;
  let totalNewBytes = 0;
  const failed = [];

  for (const article of candidates) {
    if (DRY_RUN) {
      console.log(`Checking: ${article.slug}`);
      console.log(`  [dry-run] Would download and check size: ${article.image_url}`);
      continue;
    }

    try {
      const res = await fetch(article.image_url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const originalBuffer = Buffer.from(await res.arrayBuffer());

      if (originalBuffer.length <= SIZE_THRESHOLD_BYTES) {
        skipped += 1;
        await sleep(50); // still a real request even when skipping — don't hammer the CDN
        continue;
      }

      console.log(`Processing: ${article.slug} (${(originalBuffer.length / 1024).toFixed(0)}KB — over threshold)`);

      const unsupportedFormat = getKnownUnsupportedFormat(originalBuffer);
      if (unsupportedFormat) {
        console.log(`  [failed] Mime type ${unsupportedFormat} does not support decoding`);
        failed.push(article.slug);
        await sleep(50);
        continue;
      }

      let dims;
      try {
        dims = imageSize(originalBuffer);
      } catch {
        console.log(`  [skipped] Could not read image dimensions — leaving as-is rather than risk a crash on an unreadable file.`);
        skipped += 1;
        await sleep(50);
        continue;
      }
      const megapixels = (dims.width * dims.height) / 1_000_000;
      if (!Number.isFinite(megapixels) || megapixels <= 0) {
        console.log(`  [skipped] Could not determine valid dimensions (got ${dims.width}x${dims.height}) — treating as unsafe rather than risking a crash on an unusual file.`);
        skipped += 1;
        await sleep(50);
        continue;
      }
      if (megapixels > MAX_MEGAPIXELS) {
        console.log(`  [skipped] ${dims.width}x${dims.height} (${megapixels.toFixed(0)}MP) — unusually large dimensions for a modest file size, likely to crash on decode. Flagging for manual review instead of risking it.`);
        skipped += 1;
        await sleep(50);
        continue;
      }

      const tempIn = `/tmp/reprocess-in-${article.id}.tmp`;
      const tempOut = `/tmp/reprocess-out-${article.id}.jpg`;
      fs.writeFileSync(tempIn, originalBuffer);

      // Persisted BEFORE the risky call, and awaited, so it's durably saved
      // even if the very next line kills the whole container.
      await savePersistedState({ inProgressSlug: article.slug, confirmedProblems: persisted.confirmedProblems });
      try {
        execFileSync(
          'node',
          ['--max-old-space-size=300', WORKER_PATH, tempIn, tempOut, String(MAX_WIDTH), String(JPEG_QUALITY)],
          { timeout: 20000, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'] }
        );
      } catch (workerErr) {
        // The worker process crashed or got killed for using too much memory
        // — since it ran in its own isolated process, that's all that
        // happened. The main server (and this loop) are completely fine and
        // simply move on to the next image, instead of the whole process
        // dying the way it did before this isolation was added.
        throw new Error(`Isolated compression worker failed (this image is likely corrupt or malformed): ${workerErr.stderr ? workerErr.stderr.toString().trim() : workerErr.message}`);
      } finally {
        if (fs.existsSync(tempIn)) fs.unlinkSync(tempIn);
      }
      // Made it past the risky call without the container dying — safe to
      // clear the marker now.
      await savePersistedState({ inProgressSlug: null, confirmedProblems: persisted.confirmedProblems });
      const compressedBuffer = fs.readFileSync(tempOut);
      fs.unlinkSync(tempOut);

      const oldFilename = article.image_url.split('/article-images/')[1].split('?')[0];
      const newFilename = oldFilename.replace(/\.(png|jpe?g|webp)$/i, '.jpg');

      const { error: uploadError } = await supabase.storage
        .from('article-images')
        .upload(newFilename, compressedBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const { data: urlData } = supabase.storage.from('article-images').getPublicUrl(newFilename);

      const { error: updateError } = await supabase
        .from('articles')
        .update({ image_url: urlData.publicUrl })
        .eq('id', article.id);
      if (updateError) throw new Error(`Database update failed: ${updateError.message}`);

      // Clean up the old file now that the article points elsewhere — safe to
      // do after the DB update above has succeeded, not before. Only remove
      // it if the filename actually changed (e.g. .png -> .jpg); if it was
      // already .jpg, newFilename === oldFilename and this would delete the
      // file we just uploaded.
      if (newFilename !== oldFilename) {
        await supabase.storage.from('article-images').remove([oldFilename]);
      }

      const savedKB = (originalBuffer.length - compressedBuffer.length) / 1024;
      totalOriginalBytes += originalBuffer.length;
      totalNewBytes += compressedBuffer.length;
      console.log(`  [success] ${(originalBuffer.length / 1024).toFixed(0)}KB -> ${(compressedBuffer.length / 1024).toFixed(0)}KB (saved ${savedKB.toFixed(0)}KB)`);
      succeeded += 1;
    } catch (err) {
      console.log(`  [failed] ${err.message}`);
      failed.push(article.slug);
      // Reaching this line at all proves the container survived — clear the
      // marker here too, not just on the success path, so a normal handled
      // failure never gets mistaken for a crash on the next run.
      await savePersistedState({ inProgressSlug: null, confirmedProblems: persisted.confirmedProblems });
    }

    await sleep(300);
  }

  console.log('\n=== Reprocessing complete ===');
  if (!DRY_RUN) {
    console.log(`Already fine, skipped: ${skipped}`);
    console.log(`Reprocessed successfully: ${succeeded}`);
    console.log(`Failed: ${failed.length}`);
    if (succeeded > 0) {
      const totalSavedMB = (totalOriginalBytes - totalNewBytes) / 1024 / 1024;
      const pctSaved = (100 - (totalNewBytes / totalOriginalBytes) * 100).toFixed(0);
      console.log(`Total size reduction: ${totalSavedMB.toFixed(1)}MB (${pctSaved}% smaller across all reprocessed images)`);
    }
    if (failed.length) {
      console.log('\nThese articles could not be reprocessed (left with their original image, untouched):');
      failed.forEach((slug) => console.log(`  - ${slug}`));
      console.log('\nYou can re-run this script later to retry these.');
    }
  }
}

run().catch((err) => {
  console.error('Fatal error in reprocessing run:', err);
  releaseLock();
  process.exit(1);
});

async function run() {
  if (!acquireLock()) {
    console.log('=== Image reprocessing: already running (lockfile present) — refusing to start a second instance. ===');
    console.log('If you\'re sure nothing is actually running (e.g. the container restarted and left a stale lock), delete /tmp/reprocess-images.lock and try again.');
    return;
  }
  try {
    await doRun();
  } finally {
    releaseLock();
  }
}
