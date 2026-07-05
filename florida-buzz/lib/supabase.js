const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not set yet — site will run with sample data only.');
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// Uploads generated image bytes to Supabase Storage for permanent hosting.
// Returns the permanent public URL, or null if anything fails.
async function storeGeneratedImage(imageBuffer, filename) {
  if (!supabase) return null;
  try {
    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(filename, imageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('article-images').getPublicUrl(filename);
    return data.publicUrl;
  } catch (err) {
    console.error(`  [error] Could not store generated image: ${err.message}`);
    return null;
  }
}

// Downloads a real photo from a source article (e.g. an RSS feed's linked image,
// hosted on someone else's CDN) and re-hosts it in our own Supabase Storage.
// This is what makes real photos permanent — without this step, the site would
// just be hotlinking the source's server forever, which can silently break if
// that server ever removes the image, changes its URL, or blocks hotlinking.
// Returns the permanent public URL, or null if the download/store fails for
// any reason (caller should fall back to AI generation in that case).
async function storeImageFromUrl(sourceUrl, filename) {
  if (!supabase) return null;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`Source image fetch failed: HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(filename, buffer, { contentType, upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('article-images').getPublicUrl(filename);
    return data.publicUrl;
  } catch (err) {
    console.error(`  [error] Could not download/store source image: ${err.message}`);
    return null;
  }
}

module.exports = { supabase, storeGeneratedImage, storeImageFromUrl };
