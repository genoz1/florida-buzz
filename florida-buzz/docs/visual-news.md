# Florida Buzz visual news shorts

Vertical (9:16) news-style shorts built from **article / reference stills**, kinetic captions, brand overlays, and ElevenLabs voiceover.

## Pipeline (no fal.ai)

| Step | Tool |
|------|------|
| Voiceover | **ElevenLabs direct API** (`eleven_v4`, or `eleven_v4_turbo` via env) |
| Stills animation | **Local ffmpeg** (`ffmpeg-static`) Ken Burns zoom/pan + cut rhythm |
| Captions / brand | Local ffmpeg + ASS kinetic captions + brand pill PNG |
| Price accents | **One** premium `$229` callout (no wallet / $$$$ / arrow sticker dumps) |
| Presenter | **None** — no AI host cutout |

This feature **does not use** `FAL_KEY`, fal image generation, fal ffmpeg merge, or the fal ElevenLabs proxy.

## Visual system (post-punch cleanup)

- Park photography stays the hero — overlays never cover faces with clip-art.
- Short caption beats (≤ ~4 words) with coral accent highlights.
- Single premium price card for the `$229` moment.
- Intentional Florida Buzz brand pill (top-left), location as quiet lower-third.
- Stronger Ken Burns + multi-still cuts for energy.

## Voice (Geno)

Default ElevenLabs voice is **Geno** — the same podcast host voice:

```
bg7PC2IzyIDwYgytMiW1
```

Defined as `DEFAULT_ELEVEN_VOICE_GENO` in `lib/visualNews/config.js` (mirrors `lib/podcasts/config.js`).

## Environment variables

Required for live TTS:

```
ELEVENLABS_API_KEY=<set securely; never commit>
```

Optional:

```
ELEVENLABS_MODEL_ID=eleven_v4
VISUAL_NEWS_ELEVEN_MODEL=eleven_v4          # or eleven_v4_turbo
VISUAL_NEWS_ELEVEN_VOICE=bg7PC2IzyIDwYgytMiW1   # Geno (default)
PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1 # also accepted
VISUAL_NEWS_ELEVEN_OUTPUT_FORMAT=mp3_44100_128
VISUAL_NEWS_WIDTH=720
VISUAL_NEWS_HEIGHT=1280
VISUAL_NEWS_FPS=30
SAMPLE_OUT_DIR=/opt/cursor/artifacts
SITE_URL=https://thefloridabuzz.com
```

`XI_API_KEY` is accepted as an alias for `ELEVENLABS_API_KEY`.

**Do not set `FAL_KEY` for this feature.** Guide Reels may still use fal separately; visual news is isolated.

## API

```js
const { createFloridaBuzzVisualVideo } = require('./lib/visualNews');

const result = await createFloridaBuzzVisualVideo({
  storyId: 'lightning-lane-worth-it',
  outDir: '/opt/cursor/artifacts',
});
// result.master → MP4 path
// result.usesFal === false
// result.tts.provider === 'elevenlabs-direct'
```

## Lightning Lane test path

```bash
# Live ElevenLabs v4 + local ffmpeg
ELEVENLABS_API_KEY=sk_... npm run sample:visual-news-ll

# Or reuse a prior Geno VO mp3 (assembly-only)
REUSE_VOICE=true VISUAL_NEWS_REUSE_VOICE=/tmp/fb-visual-news-ll/voice.mp3 \
  npm run sample:visual-news-ll
```

Output: `/opt/cursor/artifacts/florida-buzz-visual-news-ll.mp4`

## Content rules

- 18–28s, 720×1280 (default)
- No AI presenter
- Story-specific stills (not generic filler)
- Florida Buzz brand + location overlays
- Large kinetic captions for phone readability (clean outline, not meme spam)
- Lightning Lane sample: one premium `$229` callout only
- VO ends with Florida Buzz CTA (“Follow Florida Buzz.”)
- Default VO voice: Geno (`bg7PC2IzyIDwYgytMiW1`)
