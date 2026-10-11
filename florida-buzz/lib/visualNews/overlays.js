'use strict';

/**
 * Premium price callout for visual news (local ffmpeg compositing).
 * One clean badge — no wallet / $$$$ / arrow sticker dumps.
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

# Single premium price callout — glass card, coral accent, no meme stickers
bw, bh = 560, 200
card = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
cd = ImageDraw.Draw(card)

# Soft outer shadow
shadow = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle((18, 22, bw - 10, bh - 8), radius=28, fill=(0, 0, 0, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(10))
card = Image.alpha_composite(card, shadow)
cd = ImageDraw.Draw(card)

# Glass panel
cd.rounded_rectangle((12, 10, bw - 18, bh - 22), radius=26, fill=(12, 16, 24, 210))
# Coral left accent bar
cd.rounded_rectangle((12, 10, 28, bh - 22), radius=8, fill=(255, 78, 52, 255))
# Thin top highlight edge
cd.rounded_rectangle((28, 10, bw - 18, 14), radius=2, fill=(255, 255, 255, 35))

eyebrow_f = font(28)
price_f = font(92)
eyebrow = "SINGLE PASS"
price = "$229"

eb = cd.textbbox((0, 0), eyebrow, font=eyebrow_f)
pb = cd.textbbox((0, 0), price, font=price_f)
ex = 48
ey = 28
px = 44
py = 62

cd.text((ex, ey), eyebrow, font=eyebrow_f, fill=(255, 196, 160, 255))
cd.text((px, py), price, font=price_f, fill=(255, 255, 255, 255))

# Small "UP TO" chip on the right
chip = "UP TO"
cf = font(22)
cb = cd.textbbox((0, 0), chip, font=cf)
cw, ch = cb[2] - cb[0] + 28, cb[3] - cb[1] + 16
cx, cy = bw - cw - 36, 36
cd.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=12, fill=(255, 78, 52, 235))
cd.text((cx + 14, cy + 6), chip, font=cf, fill=(255, 255, 255, 255))

save(card, "price-callout-229.png")

# Thin brand pill (optional lower-third accent asset)
pw, ph = 420, 64
pill = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
pd = ImageDraw.Draw(pill)
pd.rounded_rectangle((0, 4, pw - 4, ph - 4), radius=18, fill=(10, 14, 22, 200))
pd.rounded_rectangle((0, 4, 10, ph - 4), radius=4, fill=(255, 78, 52, 255))
bf = font(26)
bt = "THE FLORIDA BUZZ"
bb = pd.textbbox((0, 0), bt, font=bf)
pd.text((22, (ph - (bb[3] - bb[1])) // 2 - 2), bt, font=bf, fill=(245, 248, 255, 255))
save(pill, "brand-pill.png")
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
  };
  for (const p of Object.values(files)) {
    if (!fs.existsSync(p)) throw new Error(`Missing overlay asset: ${p}`);
  }
  return files;
}

/**
 * Lightning Lane overlays — ONE price moment + persistent brand pill.
 * Positions tuned for 720x1280 so park faces stay visible.
 */
function lightningLaneOverlayPlan(assets) {
  return [
    {
      path: assets.brandPill,
      start: 0.0,
      end: 999,
      x: '28',
      y: '36',
      fadeIn: 0.25,
      fadeOut: 0.35,
    },
    {
      // Single premium $229 callout — upper third, not stacked with stickers
      path: assets.priceCallout,
      start: 2.4,
      end: 5.6,
      x: '(W-w)/2',
      y: '210',
      fadeIn: 0.18,
      fadeOut: 0.28,
    },
  ];
}

module.exports = {
  generateOverlayAssets,
  lightningLaneOverlayPlan,
};
