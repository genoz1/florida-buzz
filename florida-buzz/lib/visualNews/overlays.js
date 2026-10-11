'use strict';

/**
 * Punchy price-impact PNG overlays for visual news (local ffmpeg compositing).
 * Generated with Python/PIL at build time — no fal.ai, no AI presenter.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OVERLAY_SCRIPT = `
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out_dir = Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)

def font(size, bold=True):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def save(img, name):
    path = out_dir / name
    img.save(path, "PNG")
    print(path)

# Big $$$$ burst
w, h = 640, 220
dollars = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(dollars)
f = font(120)
text = "$$$$"
bbox = d.textbbox((0, 0), text, font=f)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x, y = (w - tw) // 2, (h - th) // 2 - 8
# soft dark plate
d.rounded_rectangle((x - 28, y - 10, x + tw + 28, y + th + 18), radius=28, fill=(10, 10, 10, 170))
for ox, oy in ((-4, 0), (4, 0), (0, -4), (0, 4), (-3, -3), (3, 3)):
    d.text((x + ox, y + oy), text, font=f, fill=(0, 0, 0, 220))
d.text((x, y), text, font=f, fill=(0, 220, 90, 255))
save(dollars, "dollars-burst.png")

# UP TO $229 price badge
bw, bh = 560, 180
badge = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
bd = ImageDraw.Draw(badge)
bd.rounded_rectangle((8, 8, bw - 8, bh - 8), radius=36, fill=(190, 20, 40, 235))
bd.rounded_rectangle((18, 18, bw - 18, bh - 18), radius=28, outline=(255, 230, 80, 255), width=5)
label_f = font(36)
price_f = font(72)
label = "UP TO"
price = "$229"
lb = bd.textbbox((0, 0), label, font=label_f)
pb = bd.textbbox((0, 0), price, font=price_f)
lx = (bw - (lb[2] - lb[0])) // 2
ly = 28
px = (bw - (pb[2] - pb[0])) // 2
py = 70
bd.text((lx, ly), label, font=label_f, fill=(255, 245, 200, 255))
bd.text((px, py), price, font=price_f, fill=(255, 255, 255, 255))
save(badge, "price-up-to-229.png")

# Empty wallet icon (simple flat graphic)
ww, wh = 280, 240
wallet = Image.new("RGBA", (ww, wh), (0, 0, 0, 0))
wd = ImageDraw.Draw(wallet)
# shadow plate
wd.rounded_rectangle((16, 20, ww - 16, wh - 16), radius=28, fill=(0, 0, 0, 140))
# wallet body
wd.rounded_rectangle((40, 55, ww - 40, wh - 45), radius=22, fill=(120, 72, 40, 255))
wd.rounded_rectangle((48, 63, ww - 48, wh - 53), radius=16, fill=(160, 100, 55, 255))
# flap
wd.rounded_rectangle((40, 40, ww - 40, 95), radius=18, fill=(95, 55, 30, 255))
# empty slot
wd.rounded_rectangle((70, 110, ww - 70, 155), radius=10, fill=(40, 25, 15, 230))
# X mark (empty)
xf = font(54)
xb = wd.textbbox((0, 0), "X", font=xf)
xx = (ww - (xb[2] - xb[0])) // 2
xy = 108
wd.text((xx, xy), "X", font=xf, fill=(255, 70, 70, 255))
# tiny moth / dust hint
wd.ellipse((95, 170, 115, 188), fill=(230, 210, 120, 220))
wd.ellipse((165, 168, 188, 190), fill=(230, 210, 120, 200))
save(wallet, "empty-wallet.png")

# PRICE SPIKE arrow callout
aw, ah = 420, 160
arrow = Image.new("RGBA", (aw, ah), (0, 0, 0, 0))
ad = ImageDraw.Draw(arrow)
ad.rounded_rectangle((10, 20, aw - 10, ah - 20), radius=24, fill=(15, 15, 20, 190))
af = font(48)
at = "PRICE SPIKE"
ab = ad.textbbox((0, 0), at, font=af)
ax = 28
ay = (ah - (ab[3] - ab[1])) // 2 - 4
ad.text((ax, ay), at, font=af, fill=(255, 80, 80, 255))
# up arrow
pts = [(aw - 95, ah - 45), (aw - 55, 35), (aw - 15, ah - 45)]
ad.polygon(pts, fill=(0, 220, 90, 255))
save(arrow, "price-spike.png")
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
    dollars: path.join(outDir, 'dollars-burst.png'),
    priceBadge: path.join(outDir, 'price-up-to-229.png'),
    wallet: path.join(outDir, 'empty-wallet.png'),
    spike: path.join(outDir, 'price-spike.png'),
  };
  for (const p of Object.values(files)) {
    if (!fs.existsSync(p)) throw new Error(`Missing overlay asset: ${p}`);
  }
  return files;
}

/**
 * Default timed overlays for the Lightning Lane price story (seconds).
 * Positions are ffmpeg overlay expressions for 720x1280.
 */
function lightningLaneOverlayPlan(assets) {
  return [
    {
      path: assets.dollars,
      start: 0.2,
      end: 3.4,
      x: '(W-w)/2',
      y: '210',
    },
    {
      path: assets.priceBadge,
      start: 2.4,
      end: 6.5,
      x: '(W-w)/2',
      y: '340',
    },
    {
      path: assets.spike,
      start: 5.8,
      end: 9.6,
      x: '36',
      y: '250',
    },
    {
      path: assets.wallet,
      start: 9.2,
      end: 13.4,
      x: 'W-w-40',
      y: '280',
    },
    {
      path: assets.dollars,
      start: 15.8,
      end: 19.5,
      x: '(W-w)/2',
      y: '240',
    },
    {
      path: assets.priceBadge,
      start: 16.4,
      end: 20.2,
      x: '(W-w)/2',
      y: '430',
    },
  ];
}

module.exports = {
  generateOverlayAssets,
  lightningLaneOverlayPlan,
};
