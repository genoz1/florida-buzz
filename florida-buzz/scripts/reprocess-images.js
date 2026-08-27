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

// Only rows whose image is (a) already in our own storage, not hotlinked
// elsewhere, and (b) still a PNG — i.e. exactly the ones storeGeneratedImage's
// old (uncompressed) code path produced, before that fix went in.
function needsReprocessing(url) {
  if (!url) return false;
  return url.includes('/storage/v1/object/public/article-images/') && /\.png(\?|$)/i.test(url);
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

  const targets = articles.filter((a) => needsReprocessing(a.image_url));
  console.log(`Found ${articles.length} articles total, ${targets.length} with an uncompressed PNG to reprocess.\n`);

  let succeeded = 0;
  let totalOriginalBytes = 0;
  let totalNewBytes = 0;
  const failed = [];

  for (const article of targets) {
    console.log(`Processing: ${article.slug}`);
    if (DRY_RUN) {
      console.log(`  [dry-run] Would download, compress, and re-upload: ${article.image_url}`);
      continue;
    }

    try {
      const res = await fetch(article.image_url);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      const originalBuffer = Buffer.from(await res.arrayBuffer());

      const img = await Jimp.read(originalBuffer);
      if (img.width > MAX_WIDTH) img.resize({ w: MAX_WIDTH });
      const compressedBuffer = await img.getBuffer('image/jpeg', { quality: JPEG_QUALITY });

      const oldFilename = article.image_url.split('/article-images/')[1].split('?')[0];
      const newFilename = oldFilename.replace(/\.png$/i, '.jpg');

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

      // Clean up the old PNG now that the article points elsewhere — safe to
      // do after the DB update above has succeeded, not before.
      await supabase.storage.from('article-images').remove([oldFilename]);

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
    console.log(`Succeeded: ${succeeded}`);
    console.log(`Failed: ${failed.length}`);
    if (succeeded > 0) {
      const totalSavedMB = (totalOriginalBytes - totalNewBytes) / 1024 / 1024;
      const pctSaved = (100 - (totalNewBytes / totalOriginalBytes) * 100).toFixed(0);
      console.log(`Total size reduction: ${totalSavedMB.toFixed(1)}MB (${pctSaved}% smaller across all reprocessed images)`);
    }
    if (failed.length) {
      console.log('\nThese articles could not be reprocessed (left with their original PNG, untouched):');
      failed.forEach((slug) => console.log(`  - ${slug}`));
      console.log('\nYou can re-run this script later to retry these.');
    }
  }
}

run().catch((err) => {
  console.error('Fatal error in reprocessing run:', err);
  process.exit(1);
});
