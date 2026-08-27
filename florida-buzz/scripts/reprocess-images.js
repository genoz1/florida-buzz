require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { Jimp } = require('jimp');

const DRY_RUN = process.env.DRY_RUN === 'true';
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 78;

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

async function run() {
  console.log(`=== Image reprocessing run — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: no images will be downloaded, converted, or saved, no rows updated.\n');

  if (!supabase) {
    console.error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing) — nothing to do.');
    return;
  }

  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, slug, image_url')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('Could not load articles:', error.message);
    return;
  }

  const candidates = articles.filter((a) => isOwnStorageUrl(a.image_url));
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
      const res = await fetch(article.image_url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const originalBuffer = Buffer.from(await res.arrayBuffer());

      if (originalBuffer.length <= SIZE_THRESHOLD_BYTES) {
        skipped += 1;
        await sleep(50); // still a real request even when skipping — don't hammer the CDN
        continue;
      }

      console.log(`Processing: ${article.slug} (${(originalBuffer.length / 1024).toFixed(0)}KB — over threshold)`);

      const img = await Jimp.read(originalBuffer);
      if (img.width > MAX_WIDTH) img.resize({ w: MAX_WIDTH });
      const compressedBuffer = await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY });

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
  process.exit(1);
});
