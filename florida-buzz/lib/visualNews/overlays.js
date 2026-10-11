'use strict';

/**
 * Premium motion-graphics accents for visual news (local ffmpeg compositing).
 * One price callout + brand pill + bottom caption scrim — no sticker dumps.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OVERLAY_SCRIPT = `
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out_dir = Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoSansDisplay-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/croscore/Arimo-Bold.ttf",
]

def font(size):
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def save(img, name):
    path = out_dir / name
    img.save(path, "PNG")
    print(path)

# Single premium price callout — glass card, coral accent
bw, bh = 520, 176
card = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
shadow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((14, 18, bw - 8, bh - 6), radius=24, fill=(0, 0, 0, 100))
shadow = shadow.filter(ImageFilter.GaussianBlur(8))
card = Image.alpha_composite(card, shadow)
cd = ImageDraw.Draw(card)

cd.rounded_rectangle((10, 8, bw - 14, bh - 18), radius=22, fill=(10, 14, 22, 220))
cd.rounded_rectangle((10, 8, 24, bh - 18), radius=6, fill=(255, 78, 52, 255))
cd.rounded_rectangle((24, 8, bw - 14, 11), radius=1, fill=(255, 255, 255, 40))

eyebrow_f = font(24)
price_f = font(84)
eyebrow = "SINGLE PASS"
price = "$229"
cd.text((40, 22), eyebrow, font=eyebrow_f, fill=(255, 190, 150, 255))
cd.text((36, 52), price, font=price_f, fill=(255, 255, 255, 255))

chip = "UP TO"
cf = font(20)
cb = cd.textbbox((0, 0), chip, font=cf)
cw, ch = cb[2] - cb[0] + 24, cb[3] - cb[1] + 14
cx, cy = bw - cw - 30, 28
cd.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=11, fill=(255, 78, 52, 240))
cd.text((cx + 12, cy + 5), chip, font=cf, fill=(255, 255, 255, 255))
save(card, "price-callout-229.png")

# Brand pill
pw, ph = 400, 56
pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
pd = ImageDraw.Draw(pill)
pd.rounded_rectangle((0, 2, pw - 2, ph - 2), radius=16, fill=(10, 14, 22, 210))
pd.rounded_rectangle((0, 2, 8, ph - 2), radius=3, fill=(255, 78, 52, 255))
bf = font(24)
bt = "THE FLORIDA BUZZ"
bb = pd.textbbox((0, 0), bt, font=bf)
pd.text((20, (ph - (bb[3] - bb[1])) // 2 - 1), bt, font=bf, fill=(245, 248, 255, 255))
save(pill, "brand-pill.png")

# Bottom caption scrim — soft gradient so type reads without covering mid-frame faces
sw, sh = 720, 360
scrim = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
for y in range(sh):
    # Transparent at top → soft dark at bottom
    t = y / (sh - 1)
    a = int(195 * (t ** 1.55))
    for x in range(sw):
        scrim.putpixel((x, y), (8, 10, 16, a))
save(scrim, "caption-scrim.png")
`;

function generateOverlayAssets(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync('python3', ['-c', OVERLAY_SCRIPT, outDir], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Overlay PNG generation failed: ${(result.stderr || result.stdout || '').slice(-800)}`);
  }
  const files = {
    priceCallout: path.join(outDir, 'price-callout-229.png'),
    brandPill: path.join(outDir, 'brand-pill.png'),
    captionScrim: path.join(outDir, 'caption-scrim.png'),
  };
  for (const p of Object.values(files)) {
    if (!fs.existsSync(p)) throw new Error(`Missing overlay asset: ${p}`);
  }
  return files;
}

/**
 * Lightning Lane overlays — brand + scrim + ONE price moment.
 * Captions pause while the $229 callout owns the frame.
 */
function lightningLaneOverlayPlan(assets) {
  return [
    {
      path: assets.captionScrim,
      start: 0.0,
      end: 999,
      x: '0',
      y: 'H-h',
      fadeIn: 0.2,
      fadeOut: 0.3,
    },
    {
      path: assets.brandPill,
      start: 0.0,
      end: 999,
      x: '24',
      y: '32',
      fadeIn: 0.2,
      fadeOut: 0.3,
    },
    {
      path: assets.priceCallout,
      start: 2.35,
      end: 5.55,
      x: '(W-w)/2',
      y: '200',
      fadeIn: 0.15,
      fadeOut: 0.25,
    },
  ];
}

module.exports = {
  generateOverlayAssets,
  lightningLaneOverlayPlan,
};
