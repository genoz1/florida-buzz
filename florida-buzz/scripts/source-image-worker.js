// Source photos are untrusted, externally hosted inputs. Decode and transform
// them in this short-lived, memory-capped process so a native decoder crash or
// an out-of-memory kill cannot terminate the RSS automation process.

const fs = require('fs');
const { Jimp } = require('jimp');

const INSTAGRAM_MIN_RATIO = 4 / 5;
const INSTAGRAM_MAX_RATIO = 1.91;

async function main() {
  const [, , inputPath, mainPath, thumbnailPath, cropBottomPercentArg] = process.argv;
  const cropBottomPercent = Number(cropBottomPercentArg || 0);
  if (!inputPath || !mainPath || !thumbnailPath) throw new Error('Missing source image worker paths.');
  if (!Number.isFinite(cropBottomPercent) || cropBottomPercent < 0 || cropBottomPercent >= 1) {
    throw new Error('Invalid cropBottomPercent.');
  }

  const image = await Jimp.read(fs.readFileSync(inputPath));

  if (cropBottomPercent > 0) {
    const keepHeight = Math.round(image.height * (1 - cropBottomPercent));
    image.crop({ x: 0, y: 0, w: image.width, h: keepHeight });
  }

  const ratio = image.width / image.height;
  if (ratio < INSTAGRAM_MIN_RATIO) {
    const targetHeight = Math.round(image.width / INSTAGRAM_MIN_RATIO);
    const y = Math.max(0, Math.round((image.height - targetHeight) / 2));
    image.crop({ x: 0, y, w: image.width, h: Math.min(targetHeight, image.height) });
  } else if (ratio > INSTAGRAM_MAX_RATIO) {
    const targetWidth = Math.round(image.height * INSTAGRAM_MAX_RATIO);
    const x = Math.max(0, Math.round((image.width - targetWidth) / 2));
    image.crop({ x, y: 0, w: Math.min(targetWidth, image.width), h: image.height });
  }

  if (image.width > 1200) image.resize({ w: 1200 });
  const mainBuffer = await image.getBuffer('image/jpeg', { quality: 78 });
  fs.writeFileSync(mainPath, mainBuffer);

  const thumbnail = image.clone();
  if (thumbnail.width > 640) thumbnail.resize({ w: 640 });
  fs.writeFileSync(thumbnailPath, await thumbnail.getBuffer('image/jpeg', { quality: 72 }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
