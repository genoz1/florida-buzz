'use strict';

const path = require('path');
const {
  HorizontalAlign,
  Jimp,
  VerticalAlign,
  loadFont,
  measureText,
  measureTextHeight,
} = require('jimp');

const WIDTH = 1080;
const HEIGHT = 1080;
const QUESTION_WIDTH = 820;
const QUESTION_HEIGHT = 360;

const COLORS = {
  cream: 0xf8f3e8ff,
  paper: 0xfffcf5ff,
  teal: 0x0e3b43ff,
  tealSoft: 0x15525cff,
  coral: 0xff6452ff,
  coralDeep: 0xe8492fff,
  gold: 0xc9a227ff,
  sand: 0xf2e8d5ff,
  ink: 0x1f2421ff,
  muted: 0x4a5350ff,
  white: 0xffffffff,
};

const CATEGORY_ACCENTS = {
  disney: 0xe8492fff,
  universal: 0x15525cff,
  cruises: 0x2c78b7ff,
  'florida-life': 0x3f6b4fff,
};

function fontPath(size, color) {
  const pluginRoot = path.resolve(path.dirname(require.resolve('@jimp/plugin-print')), '../..');
  return path.join(
    pluginRoot,
    'fonts',
    'open-sans',
    `open-sans-${size}-${color}`,
    `open-sans-${size}-${color}.fnt`
  );
}

let fontsPromise;
function loadBuzzFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      loadFont(fontPath(64, 'black')),
      loadFont(fontPath(64, 'white')),
      loadFont(fontPath(32, 'black')),
      loadFont(fontPath(32, 'white')),
    ]).then(([black64, white64, black32, white32]) => ({ black64, white64, black32, white32 }));
  }
  return fontsPromise;
}

function normalizeForBitmap(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryLabel(category) {
  return (
    {
      disney: 'DISNEY',
      universal: 'UNIVERSAL',
      cruises: 'CRUISES',
      'florida-life': 'FLORIDA LIFE',
    }[category] || 'BUZZ BOARD'
  );
}

function rectangle(width, height, color) {
  return new Jimp({ width, height, color });
}

function paintSparkle(image, x, y, size, color) {
  const half = Math.max(2, Math.floor(size / 2));
  image.composite(rectangle(size, Math.max(2, Math.floor(size / 4)), color), x, y + half - 1);
  image.composite(rectangle(Math.max(2, Math.floor(size / 4)), size, color), x + half - 1, y);
}

function paintSpeechBubble(image, x, y) {
  image.composite(rectangle(120, 78, COLORS.coral), x, y);
  image.composite(rectangle(96, 54, COLORS.white), x + 12, y + 12);
  image.composite(rectangle(14, 14, COLORS.muted), x + 28, y + 32);
  image.composite(rectangle(14, 14, COLORS.muted), x + 52, y + 32);
  image.composite(rectangle(14, 14, COLORS.muted), x + 76, y + 32);
  image.composite(rectangle(28, 18, COLORS.coral), x + 28, y + 70);
}

async function renderBuzzSocialImage({ question, category, eyebrow = 'QUESTION OF THE DAY' } = {}) {
  const normalizedQuestion = normalizeForBitmap(question);
  if (!normalizedQuestion) throw new Error('A complete discussion question is required.');

  const fonts = await loadBuzzFonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.cream);

  // Soft paper field
  image.composite(rectangle(960, 860, COLORS.paper), 60, 70);
  image.composite(rectangle(960, 10, COLORS.coral), 60, 70);

  // Brand header
  image.composite(rectangle(960, 120, COLORS.teal), 60, 80);
  image.print({ font: fonts.white64, x: 92, y: 108, text: 'FLORIDA BUZZ' });
  image.print({
    font: fonts.white32,
    x: 96,
    y: 168,
    text: 'BUZZ BOARD',
  });

  // Ribbon / QOTD banner
  const bannerText = normalizeForBitmap(eyebrow).toUpperCase();
  const bannerWidth = Math.min(860, Math.max(520, measureText(fonts.white32, bannerText) + 80));
  const bannerX = Math.round((WIDTH - bannerWidth) / 2);
  image.composite(rectangle(bannerWidth, 70, COLORS.coralDeep), bannerX, 230);
  image.print({
    font: fonts.white32,
    x: bannerX,
    y: 248,
    text: {
      text: bannerText,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: bannerWidth,
  });

  // Category chip
  const label = categoryLabel(category);
  const accent = CATEGORY_ACCENTS[category] || COLORS.gold;
  const chipWidth = Math.max(180, measureText(fonts.white32, label) + 48);
  const chipX = Math.round((WIDTH - chipWidth) / 2);
  image.composite(rectangle(chipWidth, 48, accent), chipX, 326);
  image.print({
    font: fonts.white32,
    x: chipX,
    y: 334,
    text: {
      text: label,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: chipWidth,
  });

  // Decorative dividers + sparkles
  image.composite(rectangle(280, 4, COLORS.coral), 220, 402);
  image.composite(rectangle(280, 4, COLORS.coral), 580, 402);
  paintSparkle(image, 520, 388, 28, COLORS.gold);
  paintSparkle(image, 140, 280, 22, COLORS.coral);
  paintSparkle(image, 900, 280, 22, COLORS.tealSoft);
  paintSparkle(image, 180, 760, 20, COLORS.gold);
  paintSparkle(image, 860, 720, 24, COLORS.coral);

  // Question
  const questionHeight = measureTextHeight(fonts.black64, normalizedQuestion, QUESTION_WIDTH);
  if (questionHeight > QUESTION_HEIGHT) {
    throw new Error(
      `Discussion question is too long for the social template (${normalizedQuestion.length} characters).`
    );
  }
  image.print({
    font: fonts.black64,
    x: 130,
    y: 430,
    text: {
      text: normalizedQuestion,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: QUESTION_WIDTH,
    maxHeight: QUESTION_HEIGHT,
  });

  // Conversation cue
  paintSpeechBubble(image, 820, 780);
  image.print({
    font: fonts.black32,
    x: 130,
    y: 820,
    text: 'Tap the link and leave your answer',
  });

  // Footer CTA
  image.composite(rectangle(960, 110, COLORS.teal), 60, 900);
  image.composite(rectangle(180, 10, COLORS.gold), 92, 924);
  image.print({ font: fonts.white32, x: 92, y: 946, text: 'JOIN THE BUZZ BOARD' });
  image.print({
    font: fonts.white32,
    x: 420,
    y: 946,
    text: {
      text: 'thefloridabuzz.com/buzz',
      alignmentX: HorizontalAlign.RIGHT,
    },
    maxWidth: 560,
  });

  return image.getBuffer('image/png');
}

module.exports = {
  HEIGHT,
  WIDTH,
  categoryLabel,
  normalizeForBitmap,
  renderBuzzSocialImage,
};
