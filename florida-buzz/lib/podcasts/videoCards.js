'use strict';

const path = require('path');
const { HorizontalAlign, Jimp, loadFont } = require('jimp');

const WIDTH = 1920;
const HEIGHT = 1080;
const COLORS = { teal: 0x0e3b43ff, deep: 0x082b31ff, coral: 0xff6452ff, white: 0xffffffff, sand: 0xf5efe3ff };

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

async function coverPanel(coverBuffer) {
  const cover = await Jimp.read(coverBuffer);
  cover.cover({ w: 760, h: 760 });
  return cover;
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

module.exports = { HEIGHT, WIDTH, renderAgendaCard, renderBrandCard };
