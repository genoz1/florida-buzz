# Florida Buzz visual news shorts

Vertical (9:16) news-style shorts built from **article / reference stills**, kinetic captions, brand overlays, and ElevenLabs voiceover.

## Pipeline (no fal.ai)

| Step | Tool |
|------|------|
| Voiceover | **ElevenLabs direct API** (`eleven_v4`) |
| Stills animation | **Local ffmpeg** Ken Burns zoom/pan + multi-still cuts |
| Captions / brand | ASS kinetic captions + brand pill PNG + bottom scrim |
| Price accents | **One** premium `$229` callout (no wallet / $$$$ / arrow sticker dumps) |
| Presenter | **None** |

## Voice (Geno)

`bg7PC2IzyIDwYgytMiW1` — `DEFAULT_ELEVEN_VOICE_GENO` in `lib/visualNews/config.js`.

## Lightning Lane sample

```bash
REUSE_VOICE=true VISUAL_NEWS_REUSE_VOICE=/tmp/fb-visual-news-ll/voice.mp3 \
  npm run sample:visual-news-ll
```

Output: `/opt/cursor/artifacts/florida-buzz-visual-news-ll.mp4`
