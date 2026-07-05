require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { generateArticleImage } = require('../lib/imageGen');

const DRY_RUN = process.env.DRY_RUN === 'true';

// The 3 specific articles whose source photo (Travel + Leisure) can't be
// downloaded due to that CDN blocking our server's requests. Targeted,
// one-time fix — not a bulk operation, so no surprise image-generation cost.
const TARGET_SLUGS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'secret-beaches-in-florida-for-a-quiet-day-on-the-sand',
      'florida-s-best-kept-secrets-worth-the-drive-mr4534m6',
      '20-under-the-radar-florida-spots-worth-the-drive-mr3vequ8',
    ];

async function run() {
  console.log(`=== Targeted image fix — ${new Date().toISOString()} ===`);
  console.log(`Target slugs: ${TARGET_SLUGS.join(', ')}\n`);
  if (DRY_RUN) console.log('DRY RUN: no images will be generated, no rows updated.\n');

  if (!supabase) {
    console.error('Supabase is not configured — nothing to do.');
    return;
  }

  for (const slug of TARGET_SLUGS) {
    console.log(`Processing: ${slug}`);

    const { data: article, error } = await supabase
      .from('articles')
      .select('id, title, category')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !article) {
      console.log(`  [skip] Could not find an article with this slug.`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] Would generate an AI image for: "${article.title}" (${article.category})`);
      continue;
    }

    const newImageUrl = await generateArticleImage({
      title: article.title,
      category: article.category,
      slug,
    });

    if (!newImageUrl) {
      console.log(`  [failed] Image generation failed — left untouched.`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('articles')
      .update({ image_url: newImageUrl })
      .eq('id', article.id);

    if (updateError) {
      console.log(`  [failed] Generated OK but could not update the database row: ${updateError.message}`);
      continue;
    }

    console.log(`  [success] New AI image generated and saved.`);
  }

  console.log('\n=== Done ===');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
