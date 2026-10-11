# Florida Buzz visual news shorts

Vertical (9:16) news-style shorts built as a **static slideshow** of story stills, large captions, and ElevenLabs voiceover.

## Pipeline (no fal.ai)

| Step | Tool |
|------|------|
| Voiceover | **ElevenLabs direct API** (`eleven_v4`) — Geno by default |
| Visuals | **Local ffmpeg** static full-frame stills in sequence |
| Captions | ASS — one large caption per beat |
| Stickers | **None** — no stacked $$$$ / wallet PNG dumps |
| Presenter | **None** |

## Slideshow beats (Lightning Lane)

1. Pricey ride still  
2. Lightning Lane / second ride still  
3. Real empty-wallet photo (full frame)  
4. Long line photo (full frame)  
5. Tip / CTA stills  

## Run sample

```bash
npm run sample:visual-news-ll
```

Output: `/opt/cursor/artifacts/florida-buzz-visual-news-ll.mp4`
