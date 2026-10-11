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
const QUESTION_WIDTH = 760;
const QUESTION_HEIGHT = 420;

// Florida Buzz brand colors — premium QOTD card, no Disney trademark art
// (no Mickey, no official castle, no Disney wordmark/font).
const COLORS = {
  teal: 0x0e3b43ff,
  tealMid: 0x15525cff,
  tealDeep: 0x0a2d33ff,
  coral: 0xff6452ff,
  coralDeep: 0xe8492fff,
  gold: 0xc9a227ff,
  sand: 0xf5efe3ff,
  paper: 0xfffcf7ff,
  ink: 0x1a2220ff,
  muted: 0x5a6562ff,
  white: 0xffffffff,
  shadow: 0x061a20aa,
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
      disney: 'DISNEY PARKS',
      universal: 'UNIVERSAL',
      cruises: 'CRUISES',
      'florida-life': 'FLORIDA LIFE',
    }[category] || 'BUZZ BOARD'
  );
}

function rectangle(width, height, color) {
  return new Jimp({ width, height, color });
}

/** Soft rounded panel via concentric inset rectangles (Jimp has no path API). */
function paintRoundedPanel(image, x, y, w, h, color, radius = 28) {
  const r = Math.min(radius, Math.floor(Math.min(w, h) / 2));
  image.composite(rectangle(w - r * 2, h, color), x + r, y);
  image.composite(rectangle(w, h - r * 2, color), x, y + r);
  // Corner fills as stepped blocks for a soft radius read at social scale.
  for (let i = 0; i < r; i += 1) {
    const inset = Math.round(r - Math.sqrt(Math.max(0, r * r - (r - i) * (r - i))));
    const span = w - inset * 2;
    if (span > 0) {
      image.composite(rectangle(span, 1, color), x + inset, y + i);
      image.composite(rectangle(span, 1, color), x + inset, y + h - 1 - i);
    }
  }
}

function paintSpeechBubble(image, x, y, w, h) {
  // Soft drop shadow
  paintRoundedPanel(image, x + 8, y + 12, w, h, COLORS.shadow, 36);
  // Cream paper bubble
  paintRoundedPanel(image, x, y, w, h, COLORS.paper, 36);
  // Coral accent bar along the top edge of the bubble
  image.composite(rectangle(w - 72, 8, COLORS.coral), x + 36, y);
  // Smooth-ish speech-bubble tail (fine stepped wedges read as a triangle at 1080)
  const tailX = x + 88;
  const tailY = y + h - 4;
  for (let i = 0; i < 56; i += 1) {
    const progress = i / 55;
    const half = Math.max(2, Math.round(34 * (1 - progress)));
    image.composite(rectangle(half * 2, 1, COLORS.paper), tailX + 34 - half, tailY + i);
  }
}

function paintAtmosphere(image) {
  // Polished brand field: deep teal wash — no fireworks/palms/clipart.
  image.composite(rectangle(WIDTH, HEIGHT, COLORS.teal), 0, 0);
  // Soft vertical depth via overlapping mid/deep bands (subtle, not striped)
  image.composite(rectangle(WIDTH, 180, COLORS.tealMid), 0, 0);
  image.composite(rectangle(WIDTH, 220, COLORS.tealDeep), 0, HEIGHT - 220);
  // Thin coral hairlines for a premium editorial frame
  image.composite(rectangle(WIDTH - 96, 3, COLORS.coral), 48, 48);
  image.composite(rectangle(WIDTH - 96, 3, COLORS.coral), 48, HEIGHT - 51);
}

async function renderBuzzSocialImage({ question, category, eyebrow } = {}) {
  const normalizedQuestion = normalizeForBitmap(question);
  if (!normalizedQuestion) throw new Error('A complete discussion question is required.');

  const fonts = await loadBuzzFonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.tealDeep);
  paintAtmosphere(image);

  // Brand lockup
  image.print({
    font: fonts.white64,
    x: 0,
    y: 78,
    text: {
      text: 'FLORIDA BUZZ',
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: WIDTH,
  });

  // QOTD eyebrow banner
  const bannerText = normalizeForBitmap(eyebrow || 'QUESTION OF THE DAY').toUpperCase();
  const bannerWidth = Math.min(920, Math.max(480, measureText(fonts.white32, bannerText) + 72));
  const bannerX = Math.round((WIDTH - bannerWidth) / 2);
  const bannerY = 168;
  paintRoundedPanel(image, bannerX, bannerY, bannerWidth, 56, COLORS.coralDeep, 18);
  image.print({
    font: fonts.white32,
    x: bannerX,
    y: bannerY + 12,
    text: {
      text: bannerText,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: bannerWidth,
  });

  // Category chip
  const label = categoryLabel(category);
  const accent = CATEGORY_ACCENTS[category] || COLORS.gold;
  const chipWidth = Math.max(180, measureText(fonts.white32, label) + 40);
  const chipX = Math.round((WIDTH - chipWidth) / 2);
  const chipY = bannerY + 72;
  paintRoundedPanel(image, chipX, chipY, chipWidth, 44, accent, 14);
  image.print({
    font: fonts.white32,
    x: chipX,
    y: chipY + 6,
    text: {
      text: label,
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: chipWidth,
  });

  // Speech-bubble question panel
  const bubbleX = 90;
  const bubbleY = 320;
  const bubbleW = 900;
  const bubbleH = 520;
  paintSpeechBubble(image, bubbleX, bubbleY, bubbleW, bubbleH);

  const questionHeight = measureTextHeight(fonts.black64, normalizedQuestion, QUESTION_WIDTH);
  if (questionHeight > QUESTION_HEIGHT) {
    throw new Error(
      `Discussion question is too long for the social template (${normalizedQuestion.length} characters).`
    );
  }
  image.print({
    font: fonts.black64,
    x: bubbleX + 70,
    y: bubbleY + 48,
    text: {
      text: normalizedQuestion,
      alignmentX: HorizontalAlign.CENTER,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: QUESTION_WIDTH,
    maxHeight: QUESTION_HEIGHT,
  });

  // Conversation cue under the bubble (not a doodle icon)
  image.print({
    font: fonts.white32,
    x: 0,
    y: 920,
    text: {
      text: 'Drop your answer in the comments',
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: WIDTH,
  });

  // Footer brand + URL
  image.print({
    font: fonts.white32,
    x: 0,
    y: 980,
    text: {
      text: 'thefloridabuzz.com/buzz',
      alignmentX: HorizontalAlign.CENTER,
    },
    maxWidth: WIDTH,
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
