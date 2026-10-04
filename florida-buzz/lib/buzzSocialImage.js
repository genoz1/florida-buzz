const path = require('path');
const {
  HorizontalAlign,
  Jimp,
  VerticalAlign,
  loadFont,
  measureTextHeight,
} = require('jimp');

const WIDTH = 1080;
const HEIGHT = 1080;
const QUESTION_WIDTH = 820;
const QUESTION_HEIGHT = 430;

const COLORS = {
  cream: 0xf7eedcff,
  paper: 0xfffcf5ff,
  teal: 0x0e3b43ff,
  coral: 0xf15a42ff,
  gold: 0xe7bf55ff,
  muted: 0x557076ff,
};

const CATEGORY_ACCENTS = {
  disney: 0x8c6bd8ff,
  universal: 0x159ac0ff,
  cruises: 0x2c78b7ff,
  'florida-life': 0x5f9c79ff,
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
  return ({
    disney: 'DISNEY',
    universal: 'UNIVERSAL',
    cruises: 'CRUISES',
    'florida-life': 'FLORIDA LIFE',
  })[category] || 'BUZZ BOARD';
}

function rectangle(width, height, color) {
  return new Jimp({ width, height, color });
}

async function renderBuzzSocialImage({ question, category }) {
  const normalizedQuestion = normalizeForBitmap(question);
  if (!normalizedQuestion) throw new Error('A complete discussion question is required.');

  const fonts = await loadBuzzFonts();
  const image = rectangle(WIDTH, HEIGHT, COLORS.cream);

  image.composite(rectangle(WIDTH, 258, COLORS.teal), 0, 0);
  image.composite(rectangle(WIDTH, 12, COLORS.coral), 0, 248);
  image.composite(rectangle(940, 560, COLORS.paper), 70, 300);
  image.composite(rectangle(18, 560, CATEGORY_ACCENTS[category] || COLORS.gold), 70, 300);
  image.composite(rectangle(WIDTH, 180, COLORS.teal), 0, 900);
  image.composite(rectangle(180, 12, COLORS.gold), 72, 938);

  image.print({ font: fonts.white64, x: 72, y: 56, text: 'FLORIDA BUZZ' });
  image.print({ font: fonts.white32, x: 76, y: 154, text: 'BUZZ BOARD  /  REAL FLORIDA CONVERSATIONS' });

  const label = categoryLabel(category);
  image.print({ font: fonts.black32, x: 124, y: 330, text: label });

  const questionHeight = measureTextHeight(fonts.black64, normalizedQuestion, QUESTION_WIDTH);
  if (questionHeight > QUESTION_HEIGHT) {
    throw new Error(`Discussion question is too long for the social template (${normalizedQuestion.length} characters).`);
  }
  image.print({
    font: fonts.black64,
    x: 130,
    y: 400,
    text: {
      text: normalizedQuestion,
      alignmentX: HorizontalAlign.LEFT,
      alignmentY: VerticalAlign.MIDDLE,
    },
    maxWidth: QUESTION_WIDTH,
    maxHeight: QUESTION_HEIGHT,
  });

  const brand = 'FLORIDA BUZZ';
  image.print({ font: fonts.white32, x: 72, y: 972, text: brand });
  image.print({
    font: fonts.white32,
    x: 420,
    y: 972,
    text: {
      text: 'JOIN THE CONVERSATION',
      alignmentX: HorizontalAlign.RIGHT,
    },
    maxWidth: 588,
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
