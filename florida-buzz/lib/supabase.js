const { createClient } = require('@supabase/supabase-js');
const { imageSize } = require('image-size');
const { Jimp } = require('jimp');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not set yet — site will run with sample data only.');
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// Standard IAB ad-unit dimensions. A real editorial/hero photo essentially
// never happens to match one of these exact pixel sizes — these are specific,
// widely-used ad banner specs, not coincidental photo dimensions. Any download
// matching one of these (or too small to be a real hero image) is almost
// certainly an ad or icon that slipped through a source's feed metadata,
// not the article's actual photo.
const AD_DIMENSIONS = [
  '300x250', '336x280', '728x90', '970x250', '160x600', '300x600',
  '320x50', '320x100', '970x90', '468x60', '234x60', '88x31', '300x50',
  '250x250', '200x200', '180x150', '125x125',
];
const MIN_HERO_WIDTH = 400;
const MIN_HERO_HEIGHT = 300;

function looksLikeAd(width, height) {
  if (!width || !height) return false;
  if (AD_DIMENSIONS.includes(`${width}x${height}`)) return true;
  if (width < MIN_HERO_WIDTH || height < MIN_HERO_HEIGHT) return true;
  return false;
}

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
async function storeImageFromUrl(sourceUrl, filename, { cropBottomPercent } = {}) {
  if (!supabase) return null;
  try {
    // Some publisher CDNs (Dotdash Meredith properties like Travel + Leisure
    // in particular) block image requests that don't look like a real browser.
    // A realistic User-Agent and Referer resolves this for most of them.
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Referer: new URL(sourceUrl).origin + '/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`Source image fetch failed: HTTP ${res.status}`);

    let contentType = res.headers.get('content-type') || 'image/jpeg';
    let buffer = Buffer.from(await res.arrayBuffer());

    // For sources known to bake a branding banner across the bottom of every
    // image (e.g. WDW Magic's video-roundup thumbnails), crop that strip off
    // before doing anything else, rather than discarding the whole real photo
    // for an AI-generated one. The percentage here is a first-pass estimate —
    // easy to adjust if it turns out to cut too much or too little.
    if (cropBottomPercent) {
      const img = await Jimp.read(buffer);
      const keepHeight = Math.round(img.height * (1 - cropBottomPercent));
      img.crop({ x: 0, y: 0, w: img.width, h: keepHeight });
      buffer = await img.getBuffer('image/jpeg');
      contentType = 'image/jpeg';
    }

    try {
      const dims = imageSize(buffer);
      if (looksLikeAd(dims.width, dims.height)) {
        console.log(`  [reject] Downloaded image is ${dims.width}x${dims.height} — matches a known ad size or is too small to be a real hero photo. Skipping.`);
        return null;
      }
    } catch (dimErr) {
      // If we can't even read the dimensions, treat it the same as a rejected
      // ad image rather than risk storing something broken or unreadable.
      console.log(`  [reject] Could not read image dimensions (${dimErr.message}) — skipping rather than risk a bad file.`);
      return null;
    }

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
