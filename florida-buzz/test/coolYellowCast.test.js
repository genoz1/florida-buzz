'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Jimp } = require('jimp');
const { coolYellowCast } = require('../lib/coolYellowCast');
const { EDITORIAL_PHOTO_STYLE } = require('../lib/editorialPhotoStyle');

function meanChannels(img) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function sum(x, y, idx) {
    r += this.bitmap.data[idx];
    g += this.bitmap.data[idx + 1];
    b += this.bitmap.data[idx + 2];
    n += 1;
  });
  return { r: r / n, g: g / n, b: b / n, yellowBias: (r + g) / (2 * n) - b / n };
}

test('editorial photo style asks for natural white balance, not golden-hour wash', () => {
  assert.match(EDITORIAL_PHOTO_STYLE, /NATURAL white balance/i);
  assert.match(EDITORIAL_PHOTO_STYLE, /avoid heavy yellow\/amber\/orange/i);
  assert.equal(/warm golden-hour light/i.test(EDITORIAL_PHOTO_STYLE), false);
});

test('coolYellowCast reduces yellow bias on a warm amber field', async () => {
  const img = new Jimp({ width: 32, height: 32, color: 0xffcc66ff });
  const before = meanChannels(img);
  coolYellowCast(img, 0.7);
  const after = meanChannels(img);
  assert.ok(before.yellowBias > 40, `expected strong yellow before, got ${before.yellowBias}`);
  assert.ok(after.yellowBias < before.yellowBias - 8, `expected cooler after (${after.yellowBias} vs ${before.yellowBias})`);
  assert.ok(after.b > before.b, 'blue channel should rise');
});

test('coolYellowCast leaves neutral grey largely unchanged', async () => {
  const img = new Jimp({ width: 16, height: 16, color: 0x808080ff });
  const before = meanChannels(img);
  coolYellowCast(img, 0.7);
  const after = meanChannels(img);
  assert.ok(Math.abs(after.r - before.r) < 2);
  assert.ok(Math.abs(after.g - before.g) < 2);
  assert.ok(Math.abs(after.b - before.b) < 2);
});
