const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { Jimp } = require('jimp');
const {
  inspectSourceImage,
  processSourceImageInWorker,
} = require('../lib/sourceImageProcessor');

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
  'base64'
);

function productionSizedHeader() {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(4928, 16);
  buffer.writeUInt32BE(3264, 20);
  return buffer;
}

function safeHeroHeader() {
  const buffer = productionSizedHeader();
  buffer.writeUInt32BE(400, 16);
  buffer.writeUInt32BE(300, 20);
  return buffer;
}

test('rejects the production failure dimensions before decoding in Jimp', () => {
  assert.throws(
    () => inspectSourceImage(productionSizedHeader()),
    /4928x3264.*12-megapixel safe decode limit/
  );
});

test('source image processing is delegated to a memory-capped, timed worker', async () => {
  let invocation;
  const execFileImpl = (executable, args, options, callback) => {
    invocation = { executable, args, options };
    fs.copyFileSync(args[2], args[3]);
    fs.copyFileSync(args[2], args[4]);
    callback(null, '', '');
  };

  const result = await processSourceImageInWorker(TINY_JPEG, { execFileImpl });
  assert.equal(result.mainDimensions.type, 'jpg');
  assert.equal(result.thumbnailDimensions.type, 'jpg');
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], '--max-old-space-size=256');
  assert.equal(invocation.options.timeout, 20000);
  assert.equal(invocation.options.killSignal, 'SIGKILL');
});

test('real isolated worker produces validated main and thumbnail JPEGs', async () => {
  const image = new Jimp({ width: 800, height: 600, color: 0x2f7fbfff });
  const input = await image.getBuffer('image/png');
  const result = await processSourceImageInWorker(input);

  assert.equal(result.mainDimensions.type, 'jpg');
  assert.equal(result.mainDimensions.width, 800);
  assert.equal(result.thumbnailDimensions.type, 'jpg');
  assert.equal(result.thumbnailDimensions.width, 640);
});

test('worker crash/EOF becomes a recoverable rejected promise', async () => {
  const execFileImpl = (_executable, _args, _options, callback) => {
    callback(Object.assign(new Error('containerManager.WaitPID failed: EOF'), { signal: 'SIGKILL' }), '', '');
  };
  await assert.rejects(
    processSourceImageInWorker(TINY_JPEG, { execFileImpl }),
    /exited unsuccessfully \(SIGKILL\).*WaitPID failed: EOF/
  );
});

test('worker timeout becomes a recoverable rejected promise', async () => {
  const execFileImpl = (_executable, _args, _options, callback) => {
    callback(Object.assign(new Error('timed out'), { killed: true, code: 'ETIMEDOUT' }), '', '');
  };
  await assert.rejects(
    processSourceImageInWorker(TINY_JPEG, { execFileImpl, timeoutMs: 25 }),
    /timed out after 25ms/
  );
});

test('worker nonzero exit and missing output are recoverable failures', async () => {
  const nonzero = (_executable, _args, _options, callback) => {
    callback(Object.assign(new Error('exit 1'), { code: 1 }), '', 'decoder rejected input');
  };
  await assert.rejects(
    processSourceImageInWorker(TINY_JPEG, { execFileImpl: nonzero }),
    /exited unsuccessfully.*decoder rejected input/
  );

  const missingOutput = (_executable, _args, _options, callback) => callback(null, '', '');
  await assert.rejects(
    processSourceImageInWorker(TINY_JPEG, { execFileImpl: missingOutput }),
    /ENOENT/
  );
});

test('source storage converts a worker crash to null so automation can use its AI-image fallback', async () => {
  const processor = require('../lib/sourceImageProcessor');
  const originalProcessor = processor.processSourceImageInWorker;
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_KEY;
  const supabasePath = require.resolve('../lib/supabase');

  try {
    processor.processSourceImageInWorker = async () => {
      throw new Error('Source image processor exited unsuccessfully (SIGKILL): containerManager.WaitPID failed: EOF');
    };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
    global.fetch = async () => new Response(safeHeroHeader(), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '24' },
    });
    delete require.cache[supabasePath];

    const { storeImageFromUrl } = require('../lib/supabase');
    assert.equal(await storeImageFromUrl('https://example.com/source.png', 'test.jpg'), null);
  } finally {
    processor.processSourceImageInWorker = originalProcessor;
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = originalKey;
    delete require.cache[supabasePath];
  }
});
