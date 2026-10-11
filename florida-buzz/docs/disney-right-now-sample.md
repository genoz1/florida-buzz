# Disney Right Now — no-face sample

Short-form engagement format for Florida Buzz:

- **No person on camera**
- Stock ElevenLabs voice (Matilda by default — not Geno)
- **Actual park visuals in the sample** = licensed Wikimedia Magic Kingdom stills already in `public/reels/references/`
- Captions + tip card + Florida Buzz branding

## Generate locally

```bash
# needs ELEVENLABS_API_KEY
npm run sample:disney-right-now
```

Writes `disney-right-now-sample.mp4` (and a short readme) to `/opt/cursor/artifacts` by default.

## Park footage note

| Path | Visuals |
| --- | --- |
| This sample | Real licensed park **still photos** (Ken Burns motion) |
| Guide → Reel pipeline (`lib/reels`) | AI motion clips guided by those licensed references + illustrative label — not scraped live park video |

## Buzz Board opinion posts

Paused while this channel is the focus. Resume only with both:

- `BUZZ_BOARD_SOCIAL_ENABLED=true`
- `BUZZ_BOARD_OPINION_SOCIAL_ENABLED=true`
