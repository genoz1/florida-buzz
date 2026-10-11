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

# Big $$$$ burst — dominate upper third on 720-wide
w, h = 700, 260
dollars = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(dollars)
f = font(148)
text = "$$$$"
bbox = d.textbbox((0, 0), text, font=f)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
x, y = (w - tw) // 2, (h - th) // 2 - 10
d.rounded_rectangle((x - 36, y - 14, x + tw + 36, y + th + 22), radius=34, fill=(10, 10, 10, 185))
for ox, oy in ((-5, 0), (5, 0), (0, -5), (0, 5), (-4, -4), (4, 4)):
    d.text((x + ox, y + oy), text, font=f, fill=(0, 0, 0, 230))
d.text((x, y), text, font=f, fill=(0, 230, 90, 255))
save(dollars, "dollars-burst.png")

# UP TO $229 price badge
bw, bh = 620, 210
badge = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
bd = ImageDraw.Draw(badge)
bd.rounded_rectangle((8, 8, bw - 8, bh - 8), radius=40, fill=(190, 20, 40, 240))
bd.rounded_rectangle((18, 18, bw - 18, bh - 18), radius=32, outline=(255, 230, 80, 255), width=6)
label_f = font(42)
price_f = font(88)
label = "UP TO"
price = "$229"
lb = bd.textbbox((0, 0), label, font=label_f)
pb = bd.textbbox((0, 0), price, font=price_f)
lx = (bw - (lb[2] - lb[0])) // 2
ly = 30
px = (bw - (pb[2] - pb[0])) // 2
py = 78
bd.text((lx, ly), label, font=label_f, fill=(255, 245, 200, 255))
bd.text((px, py), price, font=price_f, fill=(255, 255, 255, 255))
save(badge, "price-up-to-229.png")

# Empty wallet icon — large enough to read on phone
ww, wh = 360, 320
wallet = Image.new("RGBA", (ww, wh), (0, 0, 0, 0))
wd = ImageDraw.Draw(wallet)
wd.rounded_rectangle((12, 16, ww - 12, wh - 12), radius=34, fill=(0, 0, 0, 160))
wd.rounded_rectangle((44, 70, ww - 44, wh - 50), radius=26, fill=(120, 72, 40, 255))
wd.rounded_rectangle((54, 80, ww - 54, wh - 60), radius=18, fill=(168, 108, 58, 255))
wd.rounded_rectangle((44, 48, ww - 44, 118), radius=22, fill=(95, 55, 30, 255))
wd.rounded_rectangle((78, 140, ww - 78, 198), radius=12, fill=(40, 25, 15, 235))
xf = font(72)
xb = wd.textbbox((0, 0), "X", font=xf)
xx = (ww - (xb[2] - xb[0])) // 2
xy = 132
wd.text((xx, xy), "X", font=xf, fill=(255, 60, 60, 255))
wd.ellipse((110, 220, 140, 248), fill=(235, 215, 120, 230))
wd.ellipse((210, 218, 245, 250), fill=(235, 215, 120, 210))
save(wallet, "empty-wallet.png")

# PRICE SPIKE arrow callout
aw, ah = 520, 180
arrow = Image.new("RGBA", (aw, ah), (0, 0, 0, 0))
ad = ImageDraw.Draw(arrow)
ad.rounded_rectangle((10, 18, aw - 10, ah - 18), radius=28, fill=(15, 15, 20, 200))
af = font(56)
at = "PRICE SPIKE"
ab = ad.textbbox((0, 0), at, font=af)
ax = 32
ay = (ah - (ab[3] - ab[1])) // 2 - 4
ad.text((ax, ay), at, font=af, fill=(255, 70, 70, 255))
pts = [(aw - 110, ah - 48), (aw - 60, 32), (aw - 10, ah - 48)]
ad.polygon(pts, fill=(0, 230, 90, 255))
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
      start: 0.15,
      end: 3.2,
      x: '(W-w)/2',
      y: '180',
    },
    {
      path: assets.priceBadge,
      start: 2.2,
      end: 6.3,
      x: '(W-w)/2',
      y: '320',
    },
    {
      path: assets.spike,
      start: 5.6,
      end: 9.4,
      x: '(W-w)/2',
      y: '220',
    },
    {
      // Centered large empty-wallet — hard to miss on mobile
      path: assets.wallet,
      start: 9.0,
      end: 13.6,
      x: '(W-w)/2',
      y: '260',
    },
    {
      path: assets.dollars,
      start: 15.6,
      end: 19.4,
      x: '(W-w)/2',
      y: '200',
    },
    {
      path: assets.priceBadge,
      start: 16.2,
      end: 20.0,
      x: '(W-w)/2',
      y: '420',
    },
  ];
}

module.exports = {
  generateOverlayAssets,
  lightningLaneOverlayPlan,
};
