require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { generateArticleImage } = require('../lib/imageGen');

const DRY_RUN = process.env.DRY_RUN === 'true';

async function run() {
  console.log(`=== Guide image generation run — ${new Date().toISOString()} ===`);

  if (!supabase) {
    console.error('Supabase not configured — cannot run.');
    return;
  }

  // Only touches guides missing a real image, so it's safe to re-run any time —
  // it won't overwrite images that already look right.
  const { data: guides, error } = await supabase
    .from('articles')
    .select('id, slug, title, category, image_url')
    .eq('is_evergreen', true)
    .is('image_url', null);

  if (error) {
    console.error('Could not fetch guides:', error.message);
    return;
  }

  if (!guides || guides.length === 0) {
    console.log('No guides missing images — nothing to do.');
    return;
  }

  console.log(`Found ${guides.length} guide(s) needing an image.`);

  for (const guide of guides) {
    console.log(`\n"${guide.title}"`);
    if (DRY_RUN) {
      console.log('  [dry-run] Would generate an image here — skipped, costs real money per image.');
      continue;
    }

    const imageUrl = await generateArticleImage({
      title: guide.title,
      category: guide.category,
      slug: guide.slug,
    });

    if (!imageUrl) {
      console.log('  [error] Image generation failed — leaving this one for next run.');
      continue;
    }

    const { error: updateError } = await supabase
      .from('articles')
      .update({ image_url: imageUrl })
      .eq('id', guide.id);

    if (updateError) {
      console.error(`  [error] Generated the image but couldn't save it: ${updateError.message}`);
      continue;
    }

    console.log(`  Done — image saved.`);
  }

  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
