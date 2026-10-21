'use strict';

const path = require('path');
const { HorizontalAlign, Jimp, loadFont, measureText, intToRGBA, rgbaToInt } = require('jimp');

const WIDTH = 1920;
const HEIGHT = 1080;
const COLORS = {
  teal: 0x0e3b43ff,
  deep: 0x082b31ff,
  navy: 0x0b1f33ee,
  coral: 0xff6452ff,
  gold: 0xf5c518ff,
  white: 0xffffffff,
  sand: 0xf5efe3ff,
  ink: 0x0b1f33ee,
  inkSoft: 0x00000099,
};
const COVER_INTRO_CAPTION = 'Welcome aboard. Your next stop, the Florida Buzz Disney Podcast.';

function fontPath(size, color) {
  const pluginRoot = path.resolve(path.dirname(require.resolve('@jimp/plugin-print')), '../..');
  return path.join(pluginRoot, 'fonts', 'open-sans', `open-sans-${size}-${color}`, `open-sans-${size}-${color}.fnt`);
}

let fontsPromise;
function fonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      loadFont(fontPath(64, 'white')),
      loadFont(fontPath(32, 'white')),
      loadFont(fontPath(32, 'black')),
    ]).then(([white64, white32, black32]) => ({ white64, white32, black32 }));
  }
  return fontsPromise;
}

function rectangle(width, height, color) {
  return new Jimp({ width, height, color });
}

function normalize(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapWords(text, maxChars = 42, maxLines = 2) {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

const AGENDA_TRAILING_STOP = new Set(['a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with']);

/** One short agenda sub-line that fits a menu card without wrapping/clipping. */
function shortAgendaBlurb(text, { maxChars = 32, maxWords = 5 } = {}) {
  const words = normalize(String(text || '').replace(/-/g, ' '))
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, Math.max(1, Number(maxWords) || 5));
  if (!words.length) return '';
  let kept = [];
  for (const word of words) {
    const next = kept.length ? `${kept.join(' ')} ${word}` : word;
    if (next.length > maxChars && kept.length) break;
    kept.push(word);
  }
  while (kept.length > 1 && AGENDA_TRAILING_STOP.has(kept[kept.length - 1].toLowerCase())) {
    kept.pop();
  }
  const line = kept.join(' ');
  return line || words[0].slice(0, maxChars);
}

function eyebrowFromCategory(category, label) {
  const raw = normalize(category || label || 'Disney World')
    .replace(/-/g, ' ')
    .toUpperCase();
  return raw.split(/\s+/).slice(0, 4).join(' ') || 'DISNEY WORLD';
}

/** Soft blur by downscale/upscale — matches the first episode’s filled cover backdrop. */
async function blurredBackdrop(cover) {
  const filled = cover.clone().cover({ w: WIDTH, h: HEIGHT });
  const tiny = filled.clone().resize({ w: 64, h: 36 });
  const blurred = tiny.resize({ w: WIDTH, h: HEIGHT });
  blurred.scan(0, 0, WIDTH, HEIGHT, function darken(x, y, idx) {
    this.bitmap.data[idx] = Math.round(this.bitmap.data[idx] * 0.42);
    this.bitmap.data[idx + 1] = Math.round(this.bitmap.data[idx + 1] * 0.42);
    this.bitmap.data[idx + 2] = Math.round(this.bitmap.data[idx + 2] * 0.42);
  });
  return blurred;
}

async function printGoldText(image, { font, x, y, text, maxWidth }) {
  const width = Math.max(8, Number(maxWidth) || 100);
  const height = 48;
  const layer = new Jimp({ width, height, color: 0x00000000 });
  layer.print({ font, x: 0, y: 0, text, maxWidth: width });
  const gold = intToRGBA(COLORS.gold);
  layer.scan(0, 0, width, height, function tint(px, py, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a < 8) return;
    this.bitmap.data[idx] = gold.r;
    this.bitmap.data[idx + 1] = gold.g;
    this.bitmap.data[idx + 2] = gold.b;
  });
  image.composite(layer, x, y);
}

async function coverPanel(coverBuffer) {
  const cover = await Jimp.read(coverBuffer);
  cover.cover({ w: 760, h: 760 });
  return cover;
}

/**
 * Fit the full square podcast cover into 16:9 with a darkened blurred fill
 * (first ChatGPT episode style) — never crop FLORIDA BUZZ off the top.
 */
async function fitCoverFrame(coverBuffer, { caption = COVER_INTRO_CAPTION } = {}) {
  const f = await fonts();
  const cover = await Jimp.read(coverBuffer);
  const frame = await blurredBackdrop(cover);
  const fitted = cover.clone().contain({ w: WIDTH, h: HEIGHT });
  const x = Math.max(0, Math.round((WIDTH - fitted.width) / 2));
  const y = Math.max(0, Math.round((HEIGHT - fitted.height) / 2));
  frame.composite(fitted, x, y);

  const captionLines = wrapWords(caption, 52, 2);
  if (captionLines.length) {
    const captionWidth = 1400;
    const captionHeight = 28 + captionLines.length * 44;
    const captionX = Math.round((WIDTH - captionWidth) / 2);
    const captionY = HEIGHT - 150 - captionHeight;
    frame.composite(rectangle(captionWidth, captionHeight, COLORS.inkSoft), captionX, captionY);
    captionLines.forEach((line, index) => {
      frame.print({
        font: f.white32,
        x: captionX + 24,
        y: captionY + 18 + index * 44,
        text: { text: line, alignmentX: HorizontalAlign.CENTER },
        maxWidth: captionWidth - 48,
      });
    });
  }

  return frame.getBuffer('image/png');
}

/**
 * Topic still overlays matching the first published YouTube episode:
 * gold category eyebrow, white title, caption with soft shadow (no heavy plate).
 */
function fillCircle(image, cx, cy, radius, color) {
  const r = Math.max(1, Math.round(radius));
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y > r * r) continue;
      const px = cx + x;
      const py = cy + y;
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      image.setPixelColor(color, px, py);
    }
  }
}

function roundedCard(width, height, fill, border) {
  const card = rectangle(width, height, border);
  const inset = 3;
  card.composite(rectangle(width - inset * 2, height - inset * 2, fill), inset, inset);
  return card;
}

async function renderTopicFrame(imageBuffer, { label, category, caption, aiLabel = false } = {}) {
  const f = await fonts();
  const photo = await Jimp.read(imageBuffer);
  photo.cover({ w: WIDTH, h: HEIGHT });
  const image = photo;

  const eyebrow = eyebrowFromCategory(category, label);
  const title = normalize(label || 'Disney World Update');
  const titleLines = wrapWords(title, 34, 2);
  const headerWidth = 860;
  const headerHeight = 52 + titleLines.length * 48 + 24;
  image.composite(rectangle(headerWidth, headerHeight, COLORS.navy), 48, 40);
  await printGoldText(image, { font: f.white32, x: 72, y: 54, text: eyebrow, maxWidth: headerWidth - 56 });
  titleLines.forEach((line, index) => {
    image.print({ font: f.white32, x: 72, y: 100 + index * 46, text: line, maxWidth: headerWidth - 56 });
  });

  const captionLines = wrapWords(caption, 48, 2);
  if (captionLines.length) {
    const captionY = HEIGHT - 140;
    captionLines.forEach((line, index) => {
      const y = captionY + index * 44;
      // Soft drop shadow like the first episode (no opaque caption plate).
      image.print({
        font: f.black32,
        x: 2,
        y: y + 2,
        text: { text: line, alignmentX: HorizontalAlign.CENTER },
        maxWidth: WIDTH - 80,
      });
      image.print({
        font: f.white32,
        x: 0,
        y,
        text: { text: line, alignmentX: HorizontalAlign.CENTER },
        maxWidth: WIDTH - 80,
      });
    });
  }

  // AI badge intentionally omitted — illustrations are obvious; badge was distracting.
  void aiLabel;

  return image.getBuffer('image/png');
}

/**
 * Opening menu matching the first ChatGPT-built episode:
 * navy abstract backdrop, cover left, gold eyebrow + “What's in this episode”,
 * numbered topic cards with short descriptions.
 */
async function renderAgendaCard({ coverBuffer, topics, footer = '' } = {}) {
  const f = await fonts();
  const image = rectangle(WIDTH, HEIGHT, 0x071628ff);
  // Soft abstract circles like the first episode backdrop.
  fillCircle(image, 420, 220, 260, 0x0d2740ff);
  fillCircle(image, 1600, 780, 340, 0x0a2036ff);
  fillCircle(image, 980, 120, 180, 0x102c48ff);

  const cover = await coverPanel(coverBuffer);
  image.composite(cover, 110, 160);

  await printGoldText(image, {
    font: f.white32,
    x: 980,
    y: 110,
    text: "TODAY'S DISNEY WORLD ROUNDUP",
    maxWidth: 820,
  });
  image.print({ font: f.white64, x: 980, y: 160, text: "What's in this episode", maxWidth: 860 });

  const list = (topics || []).slice(0, 6);
  const cardW = 820;
  const cardH = 96;
  list.forEach((topic, index) => {
    const y = 280 + index * 112;
    image.composite(roundedCard(cardW, cardH, 0x0d2740ff, 0x2a4d6dff), 960, y);
    fillCircle(image, 1010, y + Math.round(cardH / 2), 22, COLORS.coral);
    image.print({
      font: f.white32,
      x: 986,
      y: y + 30,
      text: { text: String(index + 1), alignmentX: HorizontalAlign.CENTER },
      maxWidth: 48,
    });
    const title = normalize(topic.title);
    const blurb = shortAgendaBlurb(topic.description || topic.category || '');
    image.print({ font: f.white32, x: 1060, y: y + 18, text: title, maxWidth: 680, maxHeight: 40 });
    if (blurb && blurb.toLowerCase() !== title.toLowerCase()) {
      image.print({
        font: f.white32,
        x: 1060,
        y: y + 54,
        text: blurb,
        maxWidth: 680,
        maxHeight: 36,
      });
    }
  });

  const footerText = normalize(footer) || 'FLORIDA BUZZ: DISNEY WORLD';
  image.print({
    font: f.white32,
    x: 0,
    y: 1000,
    text: { text: footerText.toUpperCase(), alignmentX: HorizontalAlign.CENTER },
    maxWidth: WIDTH,
  });
  return image.getBuffer('image/png');
}

async function renderBrandCard({ coverBuffer, label, cta = 'Like & Subscribe' }) {
  const f = await fonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.teal);
  image.composite(await coverPanel(coverBuffer), 580, 80);
  image.composite(rectangle(1200, 160, COLORS.deep), 360, 820);
  image.print({
    font: f.white32,
    x: 400,
    y: 845,
    text: { text: normalize(label || 'Florida Buzz Disney Podcast'), alignmentX: HorizontalAlign.CENTER },
    maxWidth: 1120,
  });
  image.print({
    font: f.white32,
    x: 400,
    y: 905,
    text: { text: normalize(cta || 'Like & Subscribe'), alignmentX: HorizontalAlign.CENTER },
    maxWidth: 1120,
  });
  return image.getBuffer('image/png');
}

/** Story-locked title card used only when photo generation fails for that topic. */
async function renderTopicCard({ label, category }) {
  const f = await fonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.deep);
  image.composite(rectangle(WIDTH, 16, COLORS.coral), 0, 0);
  image.composite(rectangle(WIDTH, 16, COLORS.coral), 0, HEIGHT - 16);
  image.print({ font: f.white32, x: 160, y: 280, text: 'FLORIDA BUZZ STORY', maxWidth: 1600 });
  image.composite(rectangle(420, 6, COLORS.coral), 160, 340);
  image.print({
    font: f.white64,
    x: 160,
    y: 400,
    text: normalize(label || category || 'Disney World Update'),
    maxWidth: 1600,
    maxHeight: 320,
  });
  if (category) {
    image.print({ font: f.white32, x: 160, y: 780, text: normalize(category.replace(/-/g, ' ')), maxWidth: 1600 });
  }
  image.print({ font: f.white32, x: 160, y: 930, text: 'thefloridabuzz.com', maxWidth: 800 });
  return image.getBuffer('image/png');
}

/** Build a 1280×720 JPEG-friendly PNG for YouTube custom thumbnails from a topic frame. */
async function renderThumbnailFrame(imageBuffer, { label, category } = {}) {
  const framed = await renderTopicFrame(imageBuffer, {
    label,
    category,
    caption: '',
    aiLabel: false,
  });
  const full = await Jimp.read(framed);
  full.cover({ w: 1280, h: 720 });
  return full.getBuffer('image/png');
}

module.exports = {
  COVER_INTRO_CAPTION,
  HEIGHT,
  WIDTH,
  eyebrowFromCategory,
  fitCoverFrame,
  renderAgendaCard,
  renderBrandCard,
  renderThumbnailFrame,
  renderTopicCard,
  shortAgendaBlurb,
  renderTopicFrame,
  wrapWords,
};
