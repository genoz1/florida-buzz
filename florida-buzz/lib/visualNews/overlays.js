'use strict';

/** Visual-news overlays disabled — no sticker dumps, no Universal assets. */
const fs = require('node:fs');

function generateOverlayAssets(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return { dir: outDir };
}

function lightningLaneOverlayPlan() {
  return [];
}

module.exports = { generateOverlayAssets, lightningLaneOverlayPlan };
