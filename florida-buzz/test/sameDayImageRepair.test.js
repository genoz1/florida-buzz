'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { startSameDayImageRepair } = require('../scripts/automate');

test('same-day image repair spawns the approved repair script for one slug', () => {
  const calls = [];
  const started = startSameDayImageRepair('cape-canaveral-falcon-9-cargo-dragon-launch', {
    spawnImpl: (...args) => {
      calls.push(args);
      return { unref() {} };
    },
    execPath: '/usr/bin/node',
    scriptPath: '/app/scripts/repair-article-images.js',
    env: { PATH: '/usr/bin', SKIP_SAME_DAY_IMAGE_REPAIR: 'false' },
    logger: { log() {}, error() {} },
  });
  assert.equal(started, true);
  assert.equal(calls.length, 1);
  const [execPath, argv, options] = calls[0];
  assert.equal(execPath, '/usr/bin/node');
  assert.deepEqual(argv, ['/app/scripts/repair-article-images.js', 'cape-canaveral-falcon-9-cargo-dragon-launch']);
  assert.equal(options.env.APPLY_IMAGE_REPAIR, 'true');
  assert.equal(options.env.PRODUCTION_IMAGE_REPAIR_APPROVED, 'true');
  assert.equal(options.env.IMAGE_REPAIR_SLUGS, 'cape-canaveral-falcon-9-cargo-dragon-launch');
  assert.equal(options.detached, true);
});

test('same-day image repair refuses invalid slugs and honor skip flag', () => {
  assert.equal(startSameDayImageRepair('../etc/passwd', {
    spawnImpl: () => { throw new Error('should not spawn'); },
  }), false);
  assert.equal(startSameDayImageRepair('valid-slug', {
    spawnImpl: () => { throw new Error('should not spawn'); },
    env: { SKIP_SAME_DAY_IMAGE_REPAIR: 'true' },
  }), false);
});

test('image repair cron runs several times a day, not only at 2:30am', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /30 2,6,10,14,18,22 \* \* \*/);
  assert.doesNotMatch(source, /cron\.schedule\('30 2 \* \* \*'/);
});
