'use strict';

/**
 * Slideshow visual-news stories set moneyOverlays: false.
 * Kept as a no-op API so callers/tests can import without sticker dumps.
 */

const fs = require('node:fs');

function generateOverlayAssets(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return { dir: outDir };
}

function lightningLaneOverlayPlan(_assets) {
  return [];
}

module.exports = {
  generateOverlayAssets,
  lightningLaneOverlayPlan,
};
