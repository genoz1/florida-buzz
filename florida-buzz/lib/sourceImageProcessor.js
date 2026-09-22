const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { imageSize } = require('image-size');

const WORKER_PATH = path.join(__dirname, '..', 'scripts', 'source-image-worker.js');
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PIXELS = 12 * 1000 * 1000;
const SOURCE_IMAGE_WORKER_TIMEOUT_MS = 20000;

function inspectSourceImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Source image download was empty.');
  }
  if (buffer.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Source image exceeds the ${MAX_SOURCE_IMAGE_BYTES / 1024 / 1024}MB download limit.`);
  }

  let dimensions;
  try {
    dimensions = imageSize(buffer);
  } catch (err) {
    throw new Error(`Could not read source image dimensions: ${err.message}`);
  }

  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Source image has invalid dimensions.');
  }
  if (width * height > MAX_SOURCE_IMAGE_PIXELS) {
    throw new Error(`Source image is ${width}x${height}, exceeding the 12-megapixel safe decode limit.`);
  }
  return dimensions;
}

function runWorker(args, { timeoutMs = SOURCE_IMAGE_WORKER_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      process.execPath,
      ['--max-old-space-size=256', WORKER_PATH, ...args],
      { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();

        if (err.killed || err.code === 'ETIMEDOUT') {
          return reject(new Error(`Source image processor timed out after ${timeoutMs}ms.`));
        }

        const details = String(stderr || err.message || 'unknown worker failure')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 300);
        return reject(new Error(`Source image processor exited unsuccessfully${err.signal ? ` (${err.signal})` : ''}: ${details}`));
      }
    );
  });
}

async function processSourceImageInWorker(buffer, { cropBottomPercent = 0, timeoutMs, execFileImpl } = {}) {
  inspectSourceImage(buffer);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'florida-buzz-source-'));
  const inputPath = path.join(tempDir, 'input-image');
  const mainPath = path.join(tempDir, 'main.jpg');
  const thumbnailPath = path.join(tempDir, 'thumbnail.jpg');

  try {
    await fs.writeFile(inputPath, buffer);
    await runWorker(
      [inputPath, mainPath, thumbnailPath, String(cropBottomPercent || 0)],
      { timeoutMs, execFileImpl }
    );

    const [mainBuffer, thumbnailBuffer] = await Promise.all([
      fs.readFile(mainPath),
      fs.readFile(thumbnailPath),
    ]);
    const mainDimensions = imageSize(mainBuffer);
    const thumbnailDimensions = imageSize(thumbnailBuffer);

    if (mainDimensions.type !== 'jpg' || thumbnailDimensions.type !== 'jpg') {
      throw new Error('Source image processor did not produce JPEG output.');
    }
    if (mainDimensions.width > 1200 || thumbnailDimensions.width > 640) {
      throw new Error('Source image processor produced output larger than the configured limits.');
    }

    return { mainBuffer, thumbnailBuffer, mainDimensions, thumbnailDimensions };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS,
  SOURCE_IMAGE_WORKER_TIMEOUT_MS,
  inspectSourceImage,
  processSourceImageInWorker,
};
