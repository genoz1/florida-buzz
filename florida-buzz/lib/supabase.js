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

module.exports = { supabase, storeGeneratedImage };
