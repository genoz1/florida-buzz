# Florida Buzz visual news shorts

Vertical (9:16) news-style shorts built as a **static slideshow** of story stills, large captions, and ElevenLabs voiceover.

## Pipeline (no fal.ai)

| Step | Tool |
|------|------|
| Voiceover | **ElevenLabs direct API** (`eleven_v4`, or `eleven_v4_turbo` via env) |
| Visuals | **Local ffmpeg** static full-frame stills in sequence |
| Captions / brand | Local ffmpeg + ASS (one large caption per beat) |
| Stickers / overlays | **None** by default — no stacked $$$$ / wallet PNG dumps |
| Presenter | **None** — no AI host cutout |

This feature **does not use** `FAL_KEY`, fal image generation, fal ffmpeg merge, or the fal ElevenLabs proxy.

## Visual system (slideshow)

- One full-frame still at a time (rides → empty wallet photo → long line → tip).
- No stacked graphics on top of park photos.
- Short caption beats with coral accent highlights.
- Subtle Florida Buzz brand + location; CTA at the end.
- Geno voiceover.

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
VISUAL_NEWS_ELEVEN_MODEL=eleven_v4
VISUAL_NEWS_ELEVEN_VOICE=bg7PC2IzyIDwYgytMiW1
SAMPLE_OUT_DIR=/opt/cursor/artifacts
REUSE_VOICE=true   # reuse prior tmp voice.mp3 (default: fresh Geno TTS)
```

`XI_API_KEY` is accepted as an alias for `ELEVENLABS_API_KEY`.

## Lightning Lane test path

```bash
ELEVENLABS_API_KEY=sk_... npm run sample:visual-news-ll
```

Output: `/opt/cursor/artifacts/florida-buzz-visual-news-ll.mp4`
