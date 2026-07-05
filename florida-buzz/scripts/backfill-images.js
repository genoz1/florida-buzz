require('dotenv').config();
const { supabase, storeImageFromUrl } = require('../lib/supabase');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Detects whether an image_url is already hosted in our own Supabase Storage
// bucket, vs. still hotlinking an external source's server.
function isAlreadyStored(url) {
  if (!url) return true; // nothing to backfill
  return url.includes('/storage/v1/object/public/article-images/');
}

async function run() {
  console.log(`=== Image backfill run — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: no images will be downloaded or saved, no rows updated.\n');

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

  const needsBackfill = articles.filter((a) => !isAlreadyStored(a.image_url));
  console.log(`Found ${articles.length} articles total, ${needsBackfill.length} still hotlinking an external image.\n`);

  const failed = [];
  let succeeded = 0;

  for (const article of needsBackfill) {
    console.log(`Processing: ${article.slug}`);
    if (DRY_RUN) {
      console.log(`  [dry-run] Would download and store: ${article.image_url}`);
      continue;
    }

    const storedUrl = await storeImageFromUrl(article.image_url, `${article.slug}.jpg`);
    if (!storedUrl) {
      console.log(`  [failed] Could not download/store — leaving existing hotlink in place for now.`);
      failed.push(article.slug);
      continue;
    }

    const { error: updateError } = await supabase
      .from('articles')
      .update({ image_url: storedUrl })
      .eq('id', article.id);

    if (updateError) {
      console.log(`  [failed] Downloaded OK but could not update the database row: ${updateError.message}`);
      failed.push(article.slug);
      continue;
    }

    console.log(`  [success] Now permanently stored.`);
    succeeded += 1;
  }

  console.log('\n=== Backfill complete ===');
  if (!DRY_RUN) {
    console.log(`Succeeded: ${succeeded}`);
    console.log(`Failed: ${failed.length}`);
    if (failed.length) {
      console.log('\nThese articles still have their original (potentially fragile) hotlinked image');
      console.log('and were left untouched rather than auto-generating a paid AI replacement for all of them:');
      failed.forEach((slug) => console.log(`  - ${slug}`));
      console.log('\nYou can re-run this script later to retry these, or handle them individually.');
    }
  }
}

run().catch((err) => {
  console.error('Fatal error in backfill run:', err);
  process.exit(1);
});
