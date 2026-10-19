'use strict';

/**
 * Soften AI golden-hour / amber washes without flattening intentional color.
 * Operates in-place on a Jimp image and returns it.
 *
 * @param {import('jimp').Jimp} img
 * @param {number} [strength=0.62] 0–1 how hard to pull yellow toward neutral
 */
function coolYellowCast(img, strength = 0.62) {
  const amount = Math.max(0, Math.min(1, Number(strength) || 0));
  if (!img || amount === 0) return img;

  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function scanPixel(x, y, idx) {
    const data = this.bitmap.data;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // Yellow excess: shared red+green above blue (classic warm cast).
    const yellow = Math.max(0, Math.min(r, g) - b);
    if (yellow <= 5) return;
    const t = Math.min(amount, yellow / 140);
    data[idx] = Math.max(0, Math.round(r - yellow * t * 0.62));
    data[idx + 1] = Math.max(0, Math.round(g - yellow * t * 0.48));
    data[idx + 2] = Math.min(255, Math.round(b + yellow * t * 0.55));
  });
  return img;
}

module.exports = { coolYellowCast };
