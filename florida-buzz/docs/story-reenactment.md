# Story-first Disney shorts

What stops the scroll is the **story**, not the format — but the story and visuals must be **clearly Disney / park-day**. Generic pool or vacation filler does not count.

- Prefer **motion** when we have Disney-relevant motion
- A **static Magic Kingdom / park still is fine** when the story is strong
- No host on camera
- No tip-card screens that explain production rules to the viewer

## Format that works

1. **Hook** — Disney stakes in the first line
2. **Story** — a real park-day mistake (wrong rope-drop side, burned Lightning Lane, etc.)
3. **Payoff rule** — one memorable takeaway
4. **Visuals** — Magic Kingdom / park context the viewer recognizes as Disney World

Example: rope-dropped Magic Kingdom, walked the wrong way first — Big Thunder walk-on, Seven Dwarfs already 75 minutes.

## Samples in this repo

| Script | Needs | Output |
| --- | --- | --- |
| `npm run sample:disney-story` | ElevenLabs | Magic Kingdom story + licensed MK stills |
| `npm run sample:story-reenactment` | ElevenLabs + motion clips | Older motion experiment (not the Disney default) |
| `node scripts/ai-story-reenactment.js --generate` | `FAL_KEY` | Custom Seedance beats for a written Disney story |

## Custom AI path

When fal is configured, Seedance can generate purpose-built motion beats for a written Disney trip story without putting Gene on camera and without trademarked characters/logos in the prompt.
