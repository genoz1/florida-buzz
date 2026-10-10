# Florida Buzz Podcasts

Isolated podcast publishing for The Florida Buzz. Public pages are on by default; paid generation stays off.

## Flags (additive — do not change unrelated existing env vars)

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=false
```

Set `PODCASTS_ENABLED=false` to unmount public/admin podcast routes.

Optional overrides:

```
PODCASTS_FAL_TTS_ENDPOINT=fal-ai/gemini-tts
PODCASTS_FAL_TTS_MODEL=gemini-2.5-pro-tts
PODCASTS_TTS_TEMPERATURE=0.85
PODCASTS_AUDIO_BUCKET=podcast-audio
PODCASTS_ARTWORK_BUCKET=podcast-artwork
PODCASTS_MAX_UPLOAD_MB=80
```

Reuses existing `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, and `FAL_KEY` when generation is later enabled.

## fal.ai Pro TTS configuration status

**Not verified against an in-repo approved trailer.** The Florida Buzz repository does not contain a locked “approved trailer” Pro-model record for Gemini TTS.

Defaults come from **public fal.ai documentation** for:

- Endpoint: `fal-ai/gemini-tts`
- Model: `gemini-2.5-pro-tts`
- Voices: Gina=`Aoede`, Diane=`Zephyr`
- Language: `English (US)`
- Output: `mp3`
- Temperature: `0.85`

If your fal account’s approved trailer uses a different endpoint alias, set `PODCASTS_FAL_TTS_ENDPOINT` / `PODCASTS_FAL_TTS_MODEL` explicitly. Do not invent private IDs.

## Manual setup still required (not done by this change)

1. Review and apply `supabase/migrations/20261010040000_podcasts.sql` only when you explicitly approve a production migration.
2. Create public Supabase Storage buckets `podcast-audio` and `podcast-artwork` (or the names you set in env).
3. Public routes mount unless `PODCASTS_ENABLED=false`.
4. Keep `PODCASTS_GENERATION_ENABLED=false` until you explicitly approve paid fal TTS usage.
5. Do not submit the RSS feed to Apple/Spotify until you approve.
6. Optional intro/outro audio fields exist on `podcast_shows`; supply only original/licensed Florida Buzz audio — never Disney music, voices, announcements, or chimes.

## Admin

`/admin/podcasts` uses HTTP Basic auth with the existing `ADMIN_PASSWORD` (same pattern as `/admin/reels`).

Publishing is manual: Approve → Publish (or Schedule status only; no scheduler runs yet).
