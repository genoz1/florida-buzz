# Story reenactment shorts

Scroll-stopping Florida Buzz videos are **mini reenactments of a trip story**, not static ride photos or tip cards.

## Format that works

1. **Hook in the first second** — someone jumping in water, a scramble, a near-miss
2. **Story VO** — what almost went wrong / what people get wrong
3. **Payoff rule** — one memorable takeaway
4. **No host on camera** — anonymous actors / AI people / licensed motion only

Example story: kids hit the hotel pool ten minutes before park open → wet flip-flop sprint → still made rope drop → rule: pool after the park.

## Samples in this repo

| Script | Needs | Output |
| --- | --- | --- |
| `npm run sample:story-reenactment` | ElevenLabs + licensed motion clips in `/tmp/fb-reenact/raw` | Real motion sample |
| `node scripts/ai-story-reenactment.js` | `FAL_KEY` (quote only) | Cost check |
| `node scripts/ai-story-reenactment.js --generate` | `FAL_KEY` + balance | Custom Seedance beats |

## Why not still photos

Static Magic Kingdom photos do not create the “I have to watch this” feeling. The product target is the same instinct as viral “people jumping in the water” clips: motion + human stakes + a story.

## Custom AI path

When fal is configured in production, Seedance text-to-video can generate purpose-built beats for each story (splash → scramble → park energy) without putting Gene on camera and without trademarked Disney characters/logos in the prompt.
