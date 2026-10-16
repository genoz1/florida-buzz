# Florida Buzz Podcasts

Isolated podcast publishing for The Florida Buzz. Public pages are on by default; paid generation stays off until explicitly enabled.

## Production voice path (solo Geno + ElevenLabs v4)

Default audio generation is **solo Geno** via ElevenLabs `eleven_v4` text-to-speech (not fal Gemini multi-speaker).

- Host: Geno 11 Instant Voice Clone `EK1vMGRoEG4LXcQRzXam`
- Script shape: Named Open (Geno Option A) → 4–6 Disney World news stories (varied length) → short partner mid-roll once → close
- Show identity: Walt Disney World **news + commentary** roundup (not a vacation-planning seminar; not fake dual-host chat)
- Named open (after announcer bumper on `intro_audio_url`): welcome / I'm your host Geno / thank you / what's happening at Disney World / let's go (never say “unofficial”; never state age in years; longevity bio is rare, not required)
- TTS: calm Geno settings (low stability, style 0, no speaker boost) + per-section variable speed + wider breath gaps between sections
- Announcer-only bumper v7 stays on `podcast_shows.intro_audio_url` and is prepended by the existing audio pipeline

### DigitalOcean App Platform env (thefloridabuzz.com)

**Required for the new path:**

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=true
ELEVENLABS_API_KEY=<set securely in DO; never commit>
PODCASTS_TTS_PROVIDER=elevenlabs
PODCASTS_ELEVEN_VOICE_GENO=EK1vMGRoEG4LXcQRzXam
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
PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS=12000
PODCASTS_SCRIPT_MIN_WORDS=1800
PODCASTS_SCRIPT_TARGET_MAX_WORDS=2400
PODCASTS_SCRIPT_TIMEOUT_MS=420000
PODCASTS_SCRIPT_CONTINUE_ATTEMPTS=2
PODCASTS_FAL_TTS_ENDPOINT=fal-ai/gemini-tts
PODCASTS_FAL_TTS_MODEL=gemini-2.5-pro-tts
PODCASTS_FAL_POLL_ATTEMPTS=180
PODCASTS_FAL_POLL_INTERVAL_MS=2000
PODCASTS_FAL_SECTION_RETRIES=2
```

Each weekly draft run creates **exactly one** standalone ~12–15 minute episode for the current slot (Tuesday run → Tuesday episode, Friday run → Friday episode). Never two episodes in one run, and never Part 1/Part 2 of one show. With generation + auto-preview on, private audio builds itself so you can listen before publishing.

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
PODCASTS_ELEVEN_VOICE_GENO=EK1vMGRoEG4LXcQRzXam
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

**Geno** is the solo news-table host. Scripts use `Geno:` lines only. Delivery is calm conversational commentary about Disney World news (not announcer/hype, not vacation-planning lectures).

### Required show open (every full episode)

After the announcer bumper, first spoken lines must be Geno Option A:

> Welcome to the Florida Buzz Disney podcast. I'm your host Geno, and thank you for joining us. Here's what's happening at Disney World. Let's go.

Then: 4–6 news story segments (with `=== SEGMENT: story-N ===` markers for per-story TTS) → short partner mid-roll once → close with merch section CTA (including “I Caught a Buzz in Florida” tees) + soft partner reminder.

### Drive listeners to TheFloridaBuzz.com

Naturally reference verified Florida Buzz resources. Say “The Florida Buzz dot com” aloud — never long URLs. Show notes include tracked links and a written “not affiliated with Disney” disclosure (do not say “unofficial” on air).

## Admin dashboard steps (after deploy)

Confirm DO env vars first (`PODCASTS_GENERATION_ENABLED=true`, `ELEVENLABS_API_KEY`, `PODCASTS_TTS_PROVIDER=elevenlabs` or omit for auto, `PODCASTS_ELEVEN_VOICE_GENO=EK1vMGRoEG4LXcQRzXam`). Apply the solo-Geno hosts migration (or run `node scripts/podcast-upload-cover.js` so RSS hosts = Geno).

1. Open `https://thefloridabuzz.com/admin/podcasts` (Basic auth).
2. Turn **weekly drafts** on (and leave auto-publish off). With `PODCASTS_GENERATION_ENABLED=true`, Tue/Fri cron (or **Run weekly draft now**) creates one standalone script and **starts private ElevenLabs preview in the background**.
3. Open that episode. If status is `generating_audio`, wait — do not need to click Generate private preview unless auto-preview was disabled or TTS failed.
4. If the script box is empty/scaffold: click **Save / generate script** and wait for a full solo Geno script (~1,800–2,400 words / ~12–15 min), then click **Generate private preview** (scaffold scripts never auto-TTS).
5. Confirm Geno Option A open + 4–6 news stories + mid-roll + CTA (`Geno:` lines only; news-table voice, not planner tips).
6. When status is `preview_ready`, play/download the private audio and listen.
7. **Approve audio** → **Publish now** only when satisfied (never auto-publishes).

### Human Geno recording (optional)

Prefer your own voice over TTS for an episode:

1. Record the episode on your phone or mic (M4A / WAV / MP3 is fine).
2. On the episode admin page, use **Record yourself → AI cleanup**.
3. Upload the file (optionally keep **Prepend announcer intro bumper** checked).
4. The server sends audio to ElevenLabs **Voice Isolator** (`/v1/audio-isolation`), which removes background noise / room tone while keeping your real voice — it does **not** clone or replace Geno.
5. Status moves `generating_audio` → `preview_ready`. Listen, then Approve → Publish as usual.

Requires `ELEVENLABS_API_KEY` (same key as TTS). Does **not** require `PODCASTS_GENERATION_ENABLED` (cleanup is not text-to-speech). For a finished MP3 with no cleanup, use **Upload replacement MP3** instead.

## ElevenLabs bakeoff scripts

Historical bakeoff notes live in `podcast-tts-elevenlabs-bakeoff.md`. Production no longer defaults to fal Gemini multi-speaker.


## YouTube video automation (no third-party app)

When a podcast episode is published in the Florida Buzz admin, the optional native video pipeline can:

1. Keep the approved podcast cover on screen through the announcer bumper and Geno's “Let's go,” letterboxed into 16:9 so the full square artwork (including FLORIDA BUZZ) stays visible.
2. Show a branded agenda card during Geno's topic summary.
3. Create two topic-matched, photorealistic editorial visuals per story (maximum three when configured). Each still must show one real, recognizable Walt Disney World place from that story — never a multi-land mashup or invented parkscape.
4. Burn on-screen topic headers, short captions from the spoken story, and an AI-generated illustration label on topic stills (matching the first published YouTube episode style).
5. Reuse previously approved visuals from the podcast artwork bucket using stable episode + story keys (so retries do not regenerate).
6. If a very specific still fails review (for example a hotel room interior), broaden to a related exterior of the **same** story subject (that hotel/attraction outside)—never a generic castle postcard, multi-land collage, or the episode cover. If photos still fail, use a story title card for that topic.
7. Assemble a 1920×1080 MP4 with the published episode audio.
8. Upload through the official YouTube Data API with `selfDeclaredMadeForKids=false`.

This does not use AI-generated motion video and does not require Metricool or another publishing service. Topic images may include families and children naturally; the upload is still marked not specifically made for children.

The feature is off until OAuth is configured:

```
PODCASTS_YOUTUBE_ENABLED=false
PODCASTS_YOUTUBE_IMAGES_PER_TOPIC=2
PODCASTS_YOUTUBE_INTRO_SECONDS=8.3
PODCASTS_YOUTUBE_PRIVACY=private
YOUTUBE_CHANNEL_ID=UCYFeYqxaQ1ue1UK_4oqsNxw
YOUTUBE_CLIENT_ID=<Google OAuth client id>
YOUTUBE_CLIENT_SECRET=<Google OAuth client secret>
YOUTUBE_REFRESH_TOKEN=<offline refresh token with youtube.upload scope>
```

Use the narrow `https://www.googleapis.com/auth/youtube.upload` OAuth scope. Keep all three OAuth values in DigitalOcean encrypted environment variables; never commit them. Enable `PODCASTS_YOUTUBE_ENABLED=true` only after a private end-to-end upload succeeds.

New, unverified Google API projects may have API uploads restricted to private visibility. Leave `PODCASTS_YOUTUBE_PRIVACY=private` during setup. Change it to `public` only after the Google project is eligible and a private test has been reviewed.

The upload is idempotent: an existing `podcast_assets` row at `youtube/<episode-id>` prevents duplicate uploads.

Published episodes can re-queue video work without changing podcast publish state via **Retry YouTube video** in admin (`POST /admin/podcasts/episodes/:id/youtube-retry`). Job start, still reuse/generate, skips, and failures are logged under `[podcasts] YouTube…`.
