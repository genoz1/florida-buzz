// Runs in its own separate OS process (spawned by reprocess-images.js), with
// its own capped memory limit (--max-old-space-size). If this process crashes
// or gets killed for using too much memory, only this one process dies — the
// server that spawned it is completely unaffected, unlike calling Jimp
// directly in-process, where a crash here took the whole site down with it.
//
// Usage: node --max-old-space-size=300 compress-worker.js <inputPath> <outputPath> <maxWidth> <quality>

const fs = require('fs');
const { Jimp } = require('jimp');

async function main() {
  const [, , inputPath, outputPath, maxWidthArg, qualityArg] = process.argv;
  const maxWidth = parseInt(maxWidthArg, 10);
  const quality = parseInt(qualityArg, 10);

  const buffer = fs.readFileSync(inputPath);
  const img = await Jimp.read(buffer);
  if (img.width > maxWidth) {
    img.resize({ w: maxWidth });
  }
  const outBuffer = await img.getBuffer('image/jpeg', { quality });
  fs.writeFileSync(outputPath, outBuffer);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
