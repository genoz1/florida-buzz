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

// Instagram rejects images outside a 4:5 (portrait) to 1.91:1 (landscape)
// aspect ratio range — real downloaded source photos can be any shape
// (panoramas, tall crops, etc.), unlike our AI-generated images which are
// always requested at a safe fixed ratio. Rather than discarding an
// otherwise-good real photo just because Instagram would reject the raw
// shape, center-crop it into the nearest allowed ratio. Returns the
// original buffer unchanged if it's already within range.
const INSTAGRAM_MIN_RATIO = 4 / 5;   // 0.8 — tallest allowed (portrait)
const INSTAGRAM_MAX_RATIO = 1.91;    // widest allowed (landscape)

// Shared by every path that stores an image for the website (AI-generated
// and real downloaded photos alike). Resizes to a sane max display width and
// re-encodes as compressed JPEG. This is what actually controls page weight —
// normalizeAspectRatio below only handles Instagram's shape requirements and
// was never resizing or compressing anything, which is why real downloaded
// photos (often several MB straight from the source publisher, full
// resolution) were a major unaddressed contributor to the site's ~12MB page
// weight and 11.6s mobile LCP (confirmed via PageSpeed Insights, Aug 2026)
// even after AI-generated images were fixed.
const WEB_IMAGE_MAX_WIDTH = 1200;
const WEB_IMAGE_JPEG_QUALITY = 78;

async function compressForWeb(buffer) {
  const img = await Jimp.read(buffer);
  if (img.width > WEB_IMAGE_MAX_WIDTH) {
    img.resize({ w: WEB_IMAGE_MAX_WIDTH });
  }
  return img.getBuffer('image/jpeg', { quality: WEB_IMAGE_JPEG_QUALITY });
}

// A second, smaller version specifically for the small "related articles"
// cards shown on nearly every page (article, category, city, guides, home,
// pillar) — those cards render at roughly 480-640px wide depending on
// screen size, so serving the same 1200px hero-sized image there wastes
// real bandwidth on every card, on every page view, site-wide. 640px
// matches what PageSpeed Insights measured as the actual rendered width on
// mobile. Stored as a genuine second file (not Supabase's paid Image
// Transformation API — that's the exact feature that already blew through
// the Storage Image Transformations quota once) so serving it is a normal,
// free file download, not a billed per-view transformation.
const THUMBNAIL_MAX_WIDTH = 640;
const THUMBNAIL_JPEG_QUALITY = 72;

async function generateThumbnail(buffer) {
  const img = await Jimp.read(buffer);
  if (img.width > THUMBNAIL_MAX_WIDTH) {
    img.resize({ w: THUMBNAIL_MAX_WIDTH });
  }
  return img.getBuffer('image/jpeg', { quality: THUMBNAIL_JPEG_QUALITY });
}

// Derives the thumbnail's filename from the main image's filename by simple
// convention (insert "-thumb" before the extension) rather than adding a
// database column — the two files live side by side in the same bucket,
// and the relationship is always computable from the one URL already
// stored on the article.
function thumbFilename(filename) {
  return filename.replace(/\.([a-z0-9]+)$/i, '-thumb.$1');
}

// Template-facing version: takes a full image URL (as stored on an article)
// and returns the thumbnail's URL, or the original URL unchanged if it's not
// one of our own Supabase-hosted images (e.g. the picsum.photos placeholders
// used when no real image exists — those have no separate thumbnail and
// were already small to begin with).
function thumbUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
  if (!imageUrl.includes('/storage/v1/object/public/article-images/')) return imageUrl;
  const [base, query] = imageUrl.split('?');
  const parts = base.split('/article-images/');
  const thumbBase = `${parts[0]}/article-images/${thumbFilename(parts[1])}`;
  return query ? `${thumbBase}?${query}` : thumbBase;
}

async function normalizeAspectRatio(buffer) {
  let dims;
  try {
    dims = imageSize(buffer);
  } catch {
    return buffer; // can't read dims — leave as-is, the caller already handles unreadable images separately
  }

  const ratio = dims.width / dims.height;
  if (ratio >= INSTAGRAM_MIN_RATIO && ratio <= INSTAGRAM_MAX_RATIO) {
    return buffer; // already within Instagram's accepted range, nothing to do
  }

  const img = await Jimp.read(buffer);
  let targetWidth = img.width;
  let targetHeight = img.height;

  if (ratio < INSTAGRAM_MIN_RATIO) {
    // Too tall/narrow (e.g. a skinny vertical crop) — trim height down to
    // the tallest ratio Instagram allows for this width.
    targetHeight = Math.round(img.width / INSTAGRAM_MIN_RATIO);
  } else {
    // Too wide (e.g. a wide panorama) — trim width down to the widest
    // ratio Instagram allows for this height.
    targetWidth = Math.round(img.height * INSTAGRAM_MAX_RATIO);
  }

  const x = Math.max(0, Math.round((img.width - targetWidth) / 2));
  const y = Math.max(0, Math.round((img.height - targetHeight) / 2));
  img.crop({
    x,
    y,
    w: Math.min(targetWidth, img.width),
    h: Math.min(targetHeight, img.height),
  });

  console.log(`  Cropped image from ${dims.width}x${dims.height} (ratio ${ratio.toFixed(2)}) to fit Instagram's supported aspect ratio range.`);
  return img.getBuffer('image/jpeg');
}

// Uploads generated image bytes to Supabase Storage for permanent hosting.
// Returns the permanent public URL, or null if anything fails. contentType
// defaults to PNG (what every AI-generated image actually is) but can be
// overridden — e.g. for a real uploaded photo, which is usually a JPEG.
//
// AI-generated images (gpt-image-1) come back as full-size 1536x1024 PNGs —
// PNG is lossless, so these run several MB each with zero compression. Serving
// them as-is is what drove the site's page weight to 12MB+ and LCP past 11s
// (confirmed via PageSpeed Insights, Aug 2026), which is a serious enough
// slowdown to plausibly affect Google's indexing decisions. Every PNG upload
// through this function is resized to a sane display width and re-encoded as
// compressed JPEG before it ever reaches storage — cuts file size by roughly
// 90%+ with no visible quality loss for a photo-style image. Already-JPEG
// uploads (e.g. real photos, user-submitted review photos) are left as-is,
// since they're not the source of the problem this fixes.
const GENERATED_IMAGE_MAX_WIDTH = 1200; // plenty for hero/thumbnail display at any real screen size
const GENERATED_IMAGE_JPEG_QUALITY = 78; // strong visual quality, small file size

async function storeGeneratedImage(imageBuffer, filename, contentType = 'image/png') {
  if (!supabase) return null;
  try {
    let finalBuffer = imageBuffer;
    let finalContentType = contentType;
    let finalFilename = filename;

    if (contentType === 'image/png') {
      const img = await Jimp.read(imageBuffer);
      if (img.width > GENERATED_IMAGE_MAX_WIDTH) {
        img.resize({ w: GENERATED_IMAGE_MAX_WIDTH });
      }
      const originalSize = imageBuffer.length;
      finalBuffer = await img.getBuffer('image/jpeg', { quality: GENERATED_IMAGE_JPEG_QUALITY });
      finalContentType = 'image/jpeg';
      finalFilename = filename.replace(/\.png$/i, '.jpg');
      console.log(`  Compressed generated image: ${(originalSize / 1024).toFixed(0)}KB PNG -> ${(finalBuffer.length / 1024).toFixed(0)}KB JPEG`);
    }

    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(finalFilename, finalBuffer, {
        contentType: finalContentType,
        upsert: true,
        // 30 days — these images never change once created, so Supabase's
        // short default cache lifetime was forcing needless repeat
        // downloads. Flagged directly by PageSpeed Insights as one of the
        // two biggest remaining opportunities (1,053 KiB) after the actual
        // image-weight fix.
        cacheControl: '2592000',
      });

    if (uploadError) throw uploadError;

    // Non-fatal: the main image already succeeded, which is what matters
    // most. If thumbnail generation has a problem, templates fall back to
    // the full-size image for cards rather than the article failing outright.
    try {
      const thumbBuffer = await generateThumbnail(finalBuffer);
      await supabase.storage.from('article-images').upload(thumbFilename(finalFilename), thumbBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '2592000',
      });
    } catch (thumbErr) {
      console.error(`  [warning] Could not generate thumbnail (article's main image is unaffected): ${thumbErr.message}`);
    }

    const { data } = supabase.storage.from('article-images').getPublicUrl(finalFilename);
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

    // Fix the aspect ratio if needed so Instagram doesn't reject this image
    // later at posting time — cheaper to fix once here than to fail silently
    // on every future post attempt using this image.
    buffer = await normalizeAspectRatio(buffer);

    // Real source photos come straight from the publisher's own CDN, often
    // several MB at full resolution with no compression at all — this is
    // what actually controls page weight, independent of the aspect-ratio
    // step above.
    const originalSize = buffer.length;
    buffer = await compressForWeb(buffer);
    contentType = 'image/jpeg';
    console.log(`  Compressed source image: ${(originalSize / 1024).toFixed(0)}KB -> ${(buffer.length / 1024).toFixed(0)}KB`);

    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(filename, buffer, { contentType, upsert: true, cacheControl: '2592000' });

    if (uploadError) throw uploadError;

    try {
      const thumbBuffer = await generateThumbnail(buffer);
      await supabase.storage.from('article-images').upload(thumbFilename(filename), thumbBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '2592000',
      });
    } catch (thumbErr) {
      console.error(`  [warning] Could not generate thumbnail (article's main image is unaffected): ${thumbErr.message}`);
    }

    const { data } = supabase.storage.from('article-images').getPublicUrl(filename);
    return data.publicUrl;
  } catch (err) {
    console.error(`  [error] Could not download/store source image: ${err.message}`);
    return null;
  }
}

module.exports = { supabase, storeGeneratedImage, storeImageFromUrl, thumbUrl };
