require('dotenv').config();
const { supabase, storeImageFromUrl } = require('../lib/supabase');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Usage: node scripts/crop-existing-image.js <slug> [cropBottomPercent]
// Example: node scripts/crop-existing-image.js flyover-farewells-and-construction 0.20
const slug = process.argv[2];
const cropBottomPercent = parseFloat(process.argv[3]) || 0.20;

async function run() {
  console.log(`=== Crop existing image — ${new Date().toISOString()} ===`);

  if (!slug) {
    console.error('Usage: node scripts/crop-existing-image.js <slug> [cropBottomPercent]');
    process.exit(1);
  }
  if (!supabase) {
    console.error('Supabase is not configured — nothing to do.');
    return;
  }

  const { data: article, error } = await supabase
    .from('articles')
    .select('id, title, image_url')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !article) {
    console.error(`Could not find an article with slug "${slug}".`);
    return;
  }

  if (!article.image_url) {
    console.error('This article has no image_url set — nothing to crop.');
    return;
  }

  console.log(`Article: ${article.title}`);
  console.log(`Current image: ${article.image_url}`);
  console.log(`Cropping bottom ${Math.round(cropBottomPercent * 100)}%...`);

  if (DRY_RUN) {
    console.log('[dry-run] Would download, crop, and re-upload to the same path.');
    return;
  }

  // Extract just the filename from the current storage URL, so re-uploading
  // to that same path overwrites it in place — the article's image_url in
  // the database doesn't need to change at all.
  const filename = article.image_url.split('/article-images/')[1];
  if (!filename) {
    console.error('Could not determine the storage filename from this URL — is it actually hosted in our own Supabase Storage?');
    return;
  }

  const resultUrl = await storeImageFromUrl(article.image_url, filename, { cropBottomPercent });

  if (!resultUrl) {
    console.error('Crop/re-upload failed — see errors above. The original image was left untouched.');
    return;
  }

  console.log(`Done. Image cropped and re-saved to the same path: ${resultUrl}`);
  console.log('\n=== Complete ===');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
