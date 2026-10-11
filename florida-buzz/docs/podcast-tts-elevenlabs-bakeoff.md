# ElevenLabs v4 TTS bakeoff (direct API)

Stopgap bakeoff while we pause the fal Gemini / fal-EL-v3 path. Uses **ElevenLabs direct API** (not fal) for **v4 multi-speaker dialogue**.

## Can we run this with your account?

**Yes.** Create an ElevenLabs account, mint an API key, and paste it into the environment as `ELEVENLABS_API_KEY` (or add it to secrets). No fal key required for the v4 path.

## Model IDs (current as of docs)

| Use case | Model ID | Endpoint |
| --- | --- | --- |
| **Multi-speaker dialogue (best for this bakeoff)** | `eleven_v4` | `POST /v1/text-to-dialogue` |
| Realtime dialogue | `eleven_v4_turbo` | Text-to-Dialogue **WebSocket** (not used here) |
| Single-speaker TTS | `eleven_v4` | `POST /v1/text-to-speech/{voice_id}` |
| Legacy dialogue default | `eleven_v3` | Same dialogue HTTP endpoint (API still defaults here) |

**v4 supports true multi-speaker dialogue** via Text to Dialogue — not line-by-line only. The bakeoff script uses one dialogue request with alternating Gena/Diane `voice_id`s. Keep total input text ≤ ~2,000 characters per request (docs reliability guidance); the ~2 min named-intro script fits in one shot. If a longer script exceeds that, the script chunks and stitches with `previous_request_ids`.

## Signup + API key

1. Sign up at [elevenlabs.io](https://elevenlabs.io).
2. Open **Profile / Developers → API Keys** and create a key.
3. Export it (never commit the key):

```bash
export ELEVENLABS_API_KEY='sk_...'
```

Or add `ELEVENLABS_API_KEY` to your secrets / DigitalOcean env for the Florida Buzz app when you wire production later.

## Voice IDs (two mom voices)

Pick two distinct **female / mid-30s American** voices in the ElevenLabs Voices UI (library or clones). Copy each voice ID.

```bash
export ELEVENLABS_VOICE_GENA='<voice_id>'   # breezier / brighter
export ELEVENLABS_VOICE_DIANE='<voice_id>'  # firmer / more grounded
```

Placeholders used if unset (premade library — swap ASAP):

| Host | Default name | Voice ID |
| --- | --- | --- |
| Gena | Sarah (soft/warm) | `EXAVITQu4vr4xnSDxMaL` |
| Diane | Matilda (warm/friendly) | `XrExE9yKIg1WjnnlVkGX` |

## Run the bakeoff (one command)

From the app root (`florida-buzz/`):

```bash
ELEVENLABS_API_KEY='sk_...' \
ELEVENLABS_VOICE_GENA='...' \
ELEVENLABS_VOICE_DIANE='...' \
node scripts/podcast-tts-bakeoff-eleven.js
```

Outputs:

- `/opt/cursor/artifacts/eleven-v4-dialogue-<stamp>.mp3` (preferred), or
- `/tmp/fb-tts-bakeoff/out/eleven-v4-dialogue-<stamp>.mp3`
- Matching `bakeoff-report-<stamp>.json`

Optional A/B against fal Gemini (only if you still have `FAL_KEY`):

```bash
FAL_KEY='...' ELEVENLABS_API_KEY='sk_...' node scripts/podcast-tts-bakeoff-eleven.js
```

Set `SKIP_FAL=1` to force ElevenLabs-only.

Clear error if the key is missing — the script exits immediately with signup instructions.

## Approximate cost

Billed per character on the API (plan-dependent). Rough guide for this bakeoff script (~1.5–2k characters of dialogue text → ~2 minutes of audio):

- **One bakeoff clip:** on the order of a few cents (often **~$0.10–0.20** at ~$0.08–0.10 / 1k characters for high-quality models; confirm current [API pricing](https://elevenlabs.io/pricing/api)).
- **Free / Starter** monthly credit pools may cover several bakeoff runs; Creator (~121k credits) is ample for iteration.
- Full ~20–25 min episodes (~3–4k spoken words ≈ ~18–25k characters) cost more — budget roughly **a few dollars per episode** on paid API rates until you lock voices/model.

Credits and USD rates change; check ElevenLabs pricing before production volume.

## What to send back to the agent

1. **`ELEVENLABS_API_KEY`** (required)
2. Optionally **`ELEVENLABS_VOICE_GENA`** and **`ELEVENLABS_VOICE_DIANE`** after you pick voices in the UI

Then one command (above) generates the clips.
