require('dotenv').config();
const inventory = require('../content/ARTICLE_IMAGE_REPAIR_INVENTORY.json');
const { generateArticleImage } = require('../lib/imageGen');
const { findDuplicateImage } = require('../lib/articleImages');
const { supabase, storeGeneratedImage } = require('../lib/supabase');

const APPLY = process.env.APPLY_IMAGE_REPAIR === 'true';
const APPROVED = process.env.PRODUCTION_IMAGE_REPAIR_APPROVED === 'true';
const requested = new Set(process.argv.slice(2));
const targets = requested.size ? inventory.filter((item) => requested.has(item.slug)) : inventory;

async function run() {
  if (!targets.length) throw new Error('No repair targets matched the supplied slugs.');
  console.log(`Article image repair plan: ${targets.length} target(s).`);
  if (!APPLY) {
    targets.forEach((item) => console.log(`[dry-run] ${item.slug}: ${item.imageSubject}`));
    console.log('Dry run only. No database, storage, generation, or social action occurred.');
    return;
  }
  if (!APPROVED) throw new Error('Applying repairs requires PRODUCTION_IMAGE_REPAIR_APPROVED=true.');
  if (!supabase) throw new Error('Supabase is not configured.');

  for (const target of targets) {
    const { data: article, error } = await supabase.from('articles')
      .select('id, slug, title, dek, body_html, category, image_url')
      .eq('slug', target.slug)
      .maybeSingle();
    if (error || !article) {
      console.warn(`[skip] ${target.slug}: article not found.`);
      continue;
    }
    if (article.image_url) {
      console.warn(`[skip] ${target.slug}: now has a stored image; review it manually before replacing.`);
      continue;
    }

    const imageUrl = await generateArticleImage({
      title: article.title,
      category: article.category,
      slug: article.slug,
      dek: article.dek,
      bodyHtml: article.body_html,
      location: target.location,
      imageSubject: target.imageSubject,
      imageEntities: target.imageEntities,
    }, {
      store: (buffer, filename) => storeGeneratedImage(buffer, filename, 'image/png', { contentAddressed: true }),
    });
    if (!imageUrl) {
      console.warn(`[skip] ${target.slug}: no relevant validated image was produced.`);
      continue;
    }

    const { data: recent, error: recentError } = await supabase.from('articles')
      .select('slug, title, image_url')
      .eq('image_url', imageUrl)
      .limit(25);
    if (recentError || findDuplicateImage(imageUrl, recent || [], article.slug)) {
      console.warn(`[skip] ${target.slug}: duplicate-image check did not pass.`);
      continue;
    }

    const { error: updateError } = await supabase.from('articles')
      .update({ image_url: imageUrl })
      .eq('id', article.id)
      .is('image_url', null);
    if (updateError) console.warn(`[skip] ${target.slug}: ${updateError.message}`);
    else console.log(`[repaired] ${target.slug}`);
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
