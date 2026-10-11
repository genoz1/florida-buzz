# Story-first shorts

What stops the scroll is the **story**, not the format.

- Prefer **motion** when we have it (splash, scramble, near-miss reenactment)
- A **static image is fine** when the story/hook is strong enough on its own
- Avoid dull ride photos + tip cards with no stakes

## Format that works

1. **Hook** — stakes in the first line (“Nobody warns you about this”)
2. **Story** — what almost went wrong / what people get wrong
3. **Payoff rule** — one memorable takeaway
4. **No host on camera** — anonymous people / AI / licensed media only

Example: kids hit the hotel pool ten minutes before park open → wet flip-flop sprint → still made rope drop → rule: pool after the park.

## Samples in this repo

| Script | Needs | Output |
| --- | --- | --- |
| `npm run sample:story-reenactment` | ElevenLabs + licensed motion clips in `/tmp/fb-reenact/raw` | Real motion sample |
| `node scripts/ai-story-reenactment.js` | `FAL_KEY` (quote only) | Cost check |
| `node scripts/ai-story-reenactment.js --generate` | `FAL_KEY` + balance | Custom Seedance beats |

## Custom AI path

When fal is configured, Seedance can generate purpose-built motion beats for a written story (splash → scramble → park energy) without putting Gene on camera and without trademarked Disney characters/logos in the prompt.
