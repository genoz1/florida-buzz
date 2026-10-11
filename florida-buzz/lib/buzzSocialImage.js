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
const QUESTION_HEIGHT = 400;

// Florida Buzz brand colors — theme-park energy without Disney trademark art
// (no Mickey, no official castle, no Disney wordmark/font).
const COLORS = {
  cream: 0xf8f3e8ff,
  paper: 0xfffcf5ff,
  night: 0x081c28ff,
  teal: 0x0e3b43ff,
  tealSoft: 0x15525cff,
  coral: 0xff6452ff,
  coralDeep: 0xe8492fff,
  gold: 0xc9a227ff,
  goldSoft: 0xe7bf55ff,
  sand: 0xf2e8d5ff,
  ink: 0x1f2421ff,
  muted: 0x4a5350ff,
  white: 0xffffffff,
  sky: 0x12364aff,
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

function paintSparkle(image, x, y, size, color) {
  const half = Math.max(2, Math.floor(size / 2));
  image.composite(rectangle(size, Math.max(2, Math.floor(size / 4)), color), x, y + half - 1);
  image.composite(rectangle(Math.max(2, Math.floor(size / 4)), size, color), x + half - 1, y);
}

function paintFirework(image, cx, cy, color, radius = 36) {
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 10) {
    for (let r = 10; r <= radius; r += 7) {
      const x = Math.round(cx + Math.cos(angle) * r - 2);
      const y = Math.round(cy + Math.sin(angle) * r - 2);
      image.composite(rectangle(4, 4, color), x, y);
    }
  }
  image.composite(rectangle(8, 8, COLORS.goldSoft), cx - 4, cy - 4);
}

function paintPalm(image, baseX, baseY, color = COLORS.tealSoft) {
  // Simple geometric Florida palm — not a character or trademark.
  image.composite(rectangle(10, 90, color), baseX, baseY);
  image.composite(rectangle(54, 10, color), baseX - 22, baseY + 8);
  image.composite(rectangle(48, 10, color), baseX - 18, baseY + 22);
  image.composite(rectangle(40, 10, color), baseX - 14, baseY + 36);
}

function paintSpeechBubble(image, x, y) {
  image.composite(rectangle(120, 78, COLORS.coral), x, y);
  image.composite(rectangle(96, 54, COLORS.white), x + 12, y + 12);
  image.composite(rectangle(14, 14, COLORS.muted), x + 28, y + 32);
  image.composite(rectangle(14, 14, COLORS.muted), x + 52, y + 32);
  image.composite(rectangle(14, 14, COLORS.muted), x + 76, y + 32);
  image.composite(rectangle(28, 18, COLORS.coral), x + 28, y + 70);
}

function paintNightSky(image) {
  // Banded night sky behind the card for Disney-topic energy.
  image.composite(rectangle(WIDTH, HEIGHT, COLORS.night), 0, 0);
  for (let i = 0; i < 10; i += 1) {
    const y = 40 + i * 18;
    const alphaBand = rectangle(WIDTH, 16, COLORS.sky);
    image.composite(alphaBand, 0, y);
  }
  paintFirework(image, 160, 120, COLORS.coral, 42);
  paintFirework(image, 920, 140, COLORS.gold, 38);
  paintFirework(image, 780, 90, COLORS.coralDeep, 28);
  paintSparkle(image, 260, 70, 18, COLORS.goldSoft);
  paintSparkle(image, 540, 50, 14, COLORS.white);
  paintSparkle(image, 680, 110, 16, COLORS.coral);
  paintPalm(image, 100, 760, 0x0a2e38ff);
  paintPalm(image, 960, 770, 0x0a2e38ff);
}

async function renderBuzzSocialImage({ question, category, eyebrow } = {}) {
  const normalizedQuestion = normalizeForBitmap(question);
  if (!normalizedQuestion) throw new Error('A complete discussion question is required.');

  const isDisney = category === 'disney';
  const fonts = await loadBuzzFonts();
  const image = rectangle(WIDTH, HEIGHT, isDisney ? COLORS.night : COLORS.cream);

  if (isDisney) {
    paintNightSky(image);
  }

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
    text: isDisney ? 'DISNEY PARK TALK' : 'BUZZ BOARD',
  });

  // Ribbon / QOTD banner
  const bannerText = normalizeForBitmap(
    eyebrow || (isDisney ? 'DISNEY QUESTION OF THE DAY' : 'QUESTION OF THE DAY')
  ).toUpperCase();
  const bannerWidth = Math.min(920, Math.max(520, measureText(fonts.white32, bannerText) + 80));
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
  const chipWidth = Math.max(200, measureText(fonts.white32, label) + 48);
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

  // Decorative dividers + sparkles / mini fireworks near the question
  image.composite(rectangle(260, 4, COLORS.coral), 230, 402);
  image.composite(rectangle(260, 4, COLORS.coral), 590, 402);
  paintSparkle(image, 520, 388, 28, COLORS.gold);
  if (isDisney) {
    paintFirework(image, 150, 480, COLORS.coral, 22);
    paintFirework(image, 930, 500, COLORS.gold, 20);
  } else {
    paintSparkle(image, 140, 280, 22, COLORS.coral);
    paintSparkle(image, 900, 280, 22, COLORS.tealSoft);
  }
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
