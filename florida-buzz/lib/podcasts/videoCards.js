'use strict';

const path = require('path');
const { HorizontalAlign, Jimp, loadFont, measureText } = require('jimp');

const WIDTH = 1920;
const HEIGHT = 1080;
const COLORS = { teal: 0x0e3b43ff, deep: 0x082b31ff, coral: 0xff6452ff, white: 0xffffffff, sand: 0xf5efe3ff, ink: 0x000000cc, inkSoft: 0x00000099 };

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
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function eyebrowFromCategory(category, label) {
  const raw = normalize(category || label || 'Disney World')
    .replace(/-/g, ' ')
    .toUpperCase();
  return raw.split(/\s+/).slice(0, 4).join(' ') || 'DISNEY WORLD';
}

async function coverPanel(coverBuffer) {
  const cover = await Jimp.read(coverBuffer);
  cover.cover({ w: 760, h: 760 });
  return cover;
}

/** Fit the full square podcast cover into 16:9 without cropping title text. */
async function fitCoverFrame(coverBuffer) {
  const cover = await Jimp.read(coverBuffer);
  const frame = rectangle(WIDTH, HEIGHT, 0x000000ff);
  const fitted = cover.contain({ w: WIDTH, h: HEIGHT });
  const x = Math.max(0, Math.round((WIDTH - fitted.width) / 2));
  const y = Math.max(0, Math.round((HEIGHT - fitted.height) / 2));
  frame.composite(fitted, x, y);
  return frame.getBuffer('image/png');
}

/** Fill 16:9 for topic photos (crop edges OK), then burn captions like the first YouTube video. */
async function renderTopicFrame(imageBuffer, { label, category, caption, aiLabel = true } = {}) {
  const f = await fonts();
  const photo = await Jimp.read(imageBuffer);
  photo.cover({ w: WIDTH, h: HEIGHT });
  const image = photo;

  const eyebrow = eyebrowFromCategory(category, label);
  const title = normalize(label || 'Disney World Update');
  const titleLines = wrapWords(title, 36, 2);
  const headerWidth = 860;
  const headerHeight = 48 + titleLines.length * 46 + 28;
  image.composite(rectangle(headerWidth, headerHeight, COLORS.ink), 48, 40);
  image.print({ font: f.white32, x: 72, y: 54, text: eyebrow, maxWidth: headerWidth - 48 });
  titleLines.forEach((line, index) => {
    image.print({ font: f.white32, x: 72, y: 100 + index * 44, text: line, maxWidth: headerWidth - 48 });
  });
  // Accent bar under eyebrow (coral strip like brand cards).
  image.composite(rectangle(220, 4, COLORS.coral), 72, 90);

  const captionLines = wrapWords(caption, 44, 2);
  if (captionLines.length) {
    const captionWidth = 1320;
    const captionHeight = 28 + captionLines.length * 44;
    const captionX = Math.round((WIDTH - captionWidth) / 2);
    const captionY = HEIGHT - 150 - captionHeight;
    image.composite(rectangle(captionWidth, captionHeight, COLORS.inkSoft), captionX, captionY);
    captionLines.forEach((line, index) => {
      image.print({
        font: f.white32,
        x: captionX + 24,
        y: captionY + 18 + index * 44,
        text: { text: line, alignmentX: HorizontalAlign.CENTER },
        maxWidth: captionWidth - 48,
      });
    });
  }

  if (aiLabel) {
    const badge = 'AI-GENERATED ILLUSTRATION';
    const badgeWidth = Math.min(420, measureText(f.white32, badge) + 36);
    const badgeHeight = 44;
    image.composite(rectangle(badgeWidth, badgeHeight, COLORS.ink), 48, HEIGHT - 72);
    image.print({ font: f.white32, x: 60, y: HEIGHT - 62, text: badge, maxWidth: badgeWidth - 20 });
  }

  return image.getBuffer('image/png');
}

async function renderAgendaCard({ coverBuffer, topics }) {
  const f = await fonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.deep);
  image.composite(rectangle(WIDTH, 16, COLORS.coral), 0, 0);
  image.composite(await coverPanel(coverBuffer), 110, 160);
  image.print({ font: f.white64, x: 980, y: 120, text: 'TODAY ON FLORIDA BUZZ', maxWidth: 820 });
  image.composite(rectangle(760, 6, COLORS.coral), 980, 215);
  const list = (topics || []).slice(0, 6);
  list.forEach((topic, index) => {
    const y = 280 + index * 118;
    image.composite(rectangle(56, 56, COLORS.coral), 980, y);
    image.print({ font: f.white32, x: 980, y: y + 8, text: { text: String(index + 1), alignmentX: HorizontalAlign.CENTER }, maxWidth: 56 });
    image.print({ font: f.white32, x: 1060, y: y + 4, text: normalize(topic.title), maxWidth: 700, maxHeight: 90 });
  });
  image.print({ font: f.white32, x: 980, y: 930, text: 'thefloridabuzz.com', maxWidth: 700 });
  return image.getBuffer('image/png');
}

async function renderBrandCard({ coverBuffer, label }) {
  const f = await fonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.teal);
  image.composite(await coverPanel(coverBuffer), 580, 80);
  image.composite(rectangle(1200, 110, COLORS.deep), 360, 865);
  image.print({ font: f.white32, x: 400, y: 900, text: { text: normalize(label || 'Florida Buzz Disney Podcast'), alignmentX: HorizontalAlign.CENTER }, maxWidth: 1120 });
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

module.exports = {
  HEIGHT,
  WIDTH,
  eyebrowFromCategory,
  fitCoverFrame,
  renderAgendaCard,
  renderBrandCard,
  renderTopicCard,
  renderTopicFrame,
  wrapWords,
};
