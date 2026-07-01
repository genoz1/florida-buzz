const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not set yet — site will run with sample data only.');
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// Downloads a (temporary) generated image and re-uploads it to Supabase Storage,
// since DALL-E's URLs expire in about an hour and we need this to last forever.
// Returns the permanent public URL, or null if anything fails.
async function storeGeneratedImage(tempUrl, filename) {
  if (!supabase) return null;
  try {
    const res = await fetch(tempUrl);
    if (!res.ok) throw new Error(`Failed to download generated image: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(filename, buffer, { contentType: 'image/png', upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('article-images').getPublicUrl(filename);
    return data.publicUrl;
  } catch (err) {
    console.error(`  [error] Could not store generated image: ${err.message}`);
    return null;
  }
}

module.exports = { supabase, storeGeneratedImage };
