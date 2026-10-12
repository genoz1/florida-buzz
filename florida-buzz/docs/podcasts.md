# Florida Buzz Podcasts

Isolated podcast publishing for The Florida Buzz. Public pages are on by default; paid generation stays off until explicitly enabled.

## Production voice path (solo Geno + ElevenLabs v4)

Default audio generation is **solo Geno** via ElevenLabs `eleven_v4` text-to-speech (not fal Gemini multi-speaker).

- Host: Geno Instant Voice Clone `bg7PC2IzyIDwYgytMiW1`
- Script shape: Named Open (Geno Option A) → Quick Hits → one Deep Dive → CTA
- Named open (after announcer bumper on `intro_audio_url`): welcome / I'm Geno / eighteen months old · over fifty years / let's go (never say “unofficial”; never state age in years)
- TTS: calm Geno settings (low stability, style 0, no speaker boost) + per-section variable speed + wider breath gaps between sections
- Announcer-only bumper v7 stays on `podcast_shows.intro_audio_url` and is prepended by the existing audio pipeline

### DigitalOcean App Platform env (thefloridabuzz.com)

**Required for the new path:**

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=true
ELEVENLABS_API_KEY=<set securely in DO; never commit>
PODCASTS_TTS_PROVIDER=elevenlabs
PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1
```

`PODCASTS_ELEVEN_VOICE_ID` is accepted as an alias for `PODCASTS_ELEVEN_VOICE_GENO`.

If `PODCASTS_TTS_PROVIDER` is omitted, the app **auto-selects ElevenLabs when `ELEVENLABS_API_KEY` is present**.

Optional:

```
PODCASTS_ELEVEN_MODEL=eleven_v4
PODCASTS_ELEVEN_OUTPUT_FORMAT=mp3_44100_128
PODCASTS_TTS_SECTION_CHARS=4000
PODCASTS_ELEVEN_SECTION_RETRIES=2
```

Optional fal fallback (not the default):

```
PODCASTS_TTS_PROVIDER=fal
FAL_KEY=<set securely in DO>
PODCASTS_VOICE_FAL_SOLO=Aoede
```

`PODCASTS_GENERATION_ENABLED` must still be `true` before any paid TTS runs. When generation is on, private preview audio starts automatically after a full weekly script (listen first — publish stays manual).

## Flags (additive)

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=false
PODCASTS_AUTO_PREVIEW_ENABLED=true
```

Set `PODCASTS_ENABLED=false` to unmount public/admin podcast routes.

- `PODCASTS_GENERATION_ENABLED=true` — allows paid ElevenLabs TTS.
- `PODCASTS_AUTO_PREVIEW_ENABLED` — defaults **on** when generation is enabled. After each successful weekly draft (full AI script, not a scaffold), the server kicks **private** preview TTS in the background. Status moves to `generating_audio` → `preview_ready`. Nothing is published to the site or RSS until you Approve → Publish. Set to `false` / `0` if you want TTS only via the admin **Generate private preview** button.

Other optional overrides:

```
PODCASTS_AUDIO_BUCKET=podcast-audio
PODCASTS_ARTWORK_BUCKET=podcast-artwork
PODCASTS_MAX_UPLOAD_MB=80
PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS=16000
PODCASTS_SCRIPT_MIN_WORDS=3000
PODCASTS_SCRIPT_TARGET_MAX_WORDS=3800
PODCASTS_SCRIPT_TIMEOUT_MS=420000
PODCASTS_SCRIPT_CONTINUE_ATTEMPTS=2
PODCASTS_FAL_TTS_ENDPOINT=fal-ai/gemini-tts
PODCASTS_FAL_TTS_MODEL=gemini-2.5-pro-tts
PODCASTS_FAL_POLL_ATTEMPTS=180
PODCASTS_FAL_POLL_INTERVAL_MS=2000
PODCASTS_FAL_SECTION_RETRIES=2
```

Each weekly draft run creates **exactly one** standalone ~20–25 minute episode for the current slot (Tuesday run → Tuesday episode, Friday run → Friday episode). Never two episodes in one run, and never Part 1/Part 2 of one show. With generation + auto-preview on, private audio builds itself so you can listen before publishing.

Reuses existing `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `OPENAI_API_KEY`. New path also needs `ELEVENLABS_API_KEY`.

## Cover art

Show cover is the approved **HOSTED BY GENO** artwork (solo — no full legal name on the cover). Upload/refresh with:

```bash
set -a; source /path/to/fb-supabase.env; set +a
node scripts/podcast-upload-cover.js
```

That writes to `podcast-artwork`, updates `podcast_shows.cover_url` / `cover_alt` / hosts, and refreshes episode `artwork_url` / `artwork_alt`. Alt text: `Florida Buzz Disney Podcast cover — hosted by Geno`.

## Approved trailer and intro (do not regenerate casually)

- Trailer MP3 is a finished approved asset — do not regenerate casually.
- Show intro: approved cold open `florida-buzz-park-intro-announcer-only-v7.mp3` (~8.3s announcer-only) on `podcast_shows.intro_audio_url`. Episode **Generate private preview** prepends that intro via `loadIntroBuffer` before the solo Geno body.
- Supply only original/licensed Florida Buzz audio — never Disney music, voices, announcements, or chimes.

## Production env checklist (Florida Buzz DigitalOcean only)

Confirm the DigitalOcean app and Supabase project are **Florida Buzz** (`tcrfirzjcjvfmiepgbjh` / thefloridabuzz.com), never ROOK.

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=true          # enables paid TTS + auto private preview after drafts
PODCASTS_AUTO_PREVIEW_ENABLED=true        # default; set false for click-only TTS
ELEVENLABS_API_KEY=sk_***                 # required for ElevenLabs path
PODCASTS_TTS_PROVIDER=elevenlabs          # or omit for auto-when-key-present
PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1
```

Keep schedule **auto_publish** off in admin while you listen to previews. Rotate any ElevenLabs key that was pasted into chat.

## Manual setup checklist

1. Apply podcast migrations on the Florida Buzz Supabase project (`tcrfirzjcjvfmiepgbjh`), including release-slot migrations.
2. Public buckets: `podcast-audio`, `podcast-artwork`.
3. Upload approved cover (Geno) and intro bytes; do not re-encode the trailer.
4. Public routes mount unless `PODCASTS_ENABLED=false`.
5. Set DO env vars above; keep generation false until ready.
6. Do not submit the RSS feed to Apple/Spotify until approved.
7. Episode masters are recompressed to ~96kbps mono before upload (Supabase Free 50MB cap).

## Weekly draft schedule (America/New_York)

Default: **two generate windows**, each creating **one** standalone review draft:

- **Tuesday 7:00 AM Eastern** → create the Tuesday episode (intended publish **Tuesday 6:00 AM ET**)
- **Friday 7:00 AM Eastern** → create the Friday episode (intended publish **Friday 6:00 AM ET**)

Admin controls (`/admin/podcasts`): enable/disable weekly drafts, review sources, regenerate scripts, listen to private previews, approve/publish.

Cron: every 15 minutes ET the server may tick `scripts/podcast-weekly-draft.js`. Drafts are never auto-published. With generation enabled, private preview audio starts after each full script so you can listen first.

## Host (full episodes)

**Geno** is the solo casual host. Scripts use `Geno:` lines only. Delivery is calm conversational (not announcer/hype).

### Required show open (every full episode)

After the announcer bumper, first spoken lines must be Geno Option A:

> Ok, welcome to Florida Buzz: Disney. I'm Geno. I've been going to Walt Disney World since I was eighteen months old — over fifty years ago — and I'm here with park news and real planning from The Florida Buzz. Here's what we're locking in today. Let's go.

Then: quick hits → one deep dive → Florida Buzz CTA / close.

### Drive listeners to TheFloridaBuzz.com

Naturally reference verified Florida Buzz resources. Say “The Florida Buzz dot com” aloud — never long URLs. Show notes include tracked links and a written “not affiliated with Disney” disclosure (do not say “unofficial” on air).

## Admin dashboard steps (after deploy)

Confirm DO env vars first (`PODCASTS_GENERATION_ENABLED=true`, `ELEVENLABS_API_KEY`, `PODCASTS_TTS_PROVIDER=elevenlabs` or omit for auto, `PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1`). Apply the solo-Geno hosts migration (or run `node scripts/podcast-upload-cover.js` so RSS hosts = Geno).

1. Open `https://thefloridabuzz.com/admin/podcasts` (Basic auth).
2. Turn **weekly drafts** on (and leave auto-publish off). With `PODCASTS_GENERATION_ENABLED=true`, Tue/Fri cron (or **Run weekly draft now**) creates one standalone script and **starts private ElevenLabs preview in the background**.
3. Open that episode. If status is `generating_audio`, wait — do not need to click Generate private preview unless auto-preview was disabled or TTS failed.
4. If the script box is empty/scaffold: click **Save / generate script** and wait for a full solo Geno script (~3,000+ words), then click **Generate private preview** (scaffold scripts never auto-TTS).
5. Confirm Geno Option A open + quick hits + deep dive + CTA (`Geno:` lines only).
6. When status is `preview_ready`, play/download the private audio and listen.
7. **Approve audio** → **Publish now** only when satisfied (never auto-publishes).

## ElevenLabs bakeoff scripts

Historical bakeoff notes live in `podcast-tts-elevenlabs-bakeoff.md`. Production no longer defaults to fal Gemini multi-speaker.
