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
# Full ~30 minute script generation (defaults are safe for a full episode)
PODCASTS_SCRIPT_MAX_OUTPUT_TOKENS=16000
PODCASTS_SCRIPT_MIN_WORDS=3000
PODCASTS_SCRIPT_TARGET_MAX_WORDS=3800
PODCASTS_SCRIPT_TIMEOUT_MS=420000
PODCASTS_SCRIPT_CONTINUE_ATTEMPTS=2
PODCASTS_TTS_SECTION_CHARS=2800
PODCASTS_FAL_POLL_ATTEMPTS=180
PODCASTS_FAL_POLL_INTERVAL_MS=2000
PODCASTS_FAL_SECTION_RETRIES=2
```

Each weekly draft run creates **exactly one** standalone ~20–25 minute episode for the current slot (Tuesday run → Tuesday episode, Friday run → Friday episode). Never two episodes in one run, and never Part 1/Part 2 of one show. Each has its own title, description, slug, and intended publish day. Each script requires at least ~3,000 spoken words, continues if the first pass is short, and fails loudly instead of accepting a teaser-length draft. Generate fal TTS separately on that episode.

Reuses existing `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, and `FAL_KEY` when generation is later enabled.

## Approved trailer and cover (do not regenerate)

The finished trailer master and cover art are supplied as approved assets:

- Trailer MP3 is fully assembled (approved intro + Gena/Diane dialogue). **Do not** regenerate with fal.ai, concatenate, trim, or otherwise modify it.
- Cover PNG/JPG is the main show artwork and trailer episode artwork.

Upload those bytes as-is to Florida Buzz Supabase storage (`podcast-audio` / `podcast-artwork`). Keep `PODCASTS_GENERATION_ENABLED=false` in production so fal cannot run until a future episode is manually approved.

## fal.ai Pro TTS configuration status (future episodes only)

**Not for the approved trailer.** Future episode generation (when explicitly enabled and approved) uses public fal Gemini TTS defaults:

Defaults come from **public fal.ai documentation** for:

- Endpoint: `fal-ai/gemini-tts`
- Model: `gemini-2.5-pro-tts`
- Voices: Gena=`Aoede`, Diane=`Zephyr`
- Spelling vs pronunciation: always spell **Gena**; pronounce like **Gina** (JEEN-uh) in TTS
- Language: `English (US)`
- Output: `mp3`
- Temperature: `0.85`

If your fal account’s approved trailer uses a different endpoint alias, set `PODCASTS_FAL_TTS_ENDPOINT` / `PODCASTS_FAL_TTS_MODEL` explicitly. Do not invent private IDs.

## Production env (Florida Buzz DigitalOcean app only)

Confirm the DigitalOcean app and Supabase project are **Florida Buzz** (`tcrfirzjcjvfmiepgbjh` / thefloridabuzz.com), never ROOK.

```
PODCASTS_ENABLED=true
PODCASTS_GENERATION_ENABLED=false
FAL_KEY=<set securely in DO; never commit>
```

`FAL_KEY` is for future manually approved episode generation only. With generation false, fal is never called. Do not use it to regenerate the approved trailer.

## Manual setup checklist

1. Apply `supabase/migrations/20261010040000_podcasts.sql` only on the Florida Buzz Supabase project.
1b. **Required for twice-weekly drafts:** apply `supabase/migrations/20261010223000_podcast_episode_release_slots.sql` and `supabase/migrations/20261010230000_podcast_dual_generate_slots.sql` in the Florida Buzz Supabase SQL editor (`tcrfirzjcjvfmiepgbjh`). Without the release-slots migration, weekly draft used to crash with `Could not find the 'intended_publish_hour' column of 'podcast_episodes' in the schema cache`. App code now degrades gracefully (stores Tuesday/Friday intent in `outline_json` and omits missing columns; Friday generate falls back to intended publish weekday B if `generate_*_b` is missing), but applying both migrations is still recommended.
2. Public buckets: `podcast-audio`, `podcast-artwork`.
3. Upload approved trailer/cover bytes as-is; do not re-encode the trailer.
4. Public routes mount unless `PODCASTS_ENABLED=false`.
5. Keep `PODCASTS_GENERATION_ENABLED=false` until a future episode is explicitly approved for generation.
6. Do not submit the RSS feed to Apple/Spotify until approved.
7. Show intro: approved `florida-buzz-park-intro-trimmed-v6.mp3` is stored on `podcast_shows.intro_audio_url`. Episode **Generate private preview** prepends that intro before the fal dialogue (trailer episode stays untouched). Supply only original/licensed Florida Buzz audio — never Disney music, voices, announcements, or chimes.
8. Episode masters are recompressed to ~96kbps mono before upload so a full ~30–45 minute show stays under Supabase Free’s **50MB** global Storage limit. In Supabase → Storage → Settings, keep Global file size at 50MB (or higher on Pro) and set the `podcast-audio` bucket limit to 50MB.

## Weekly draft schedule (America/New_York)

Default: **two generate windows**, each creating **one** standalone review draft:

- **Tuesday 7:00 AM Eastern** → create the Tuesday episode (intended publish **Tuesday 6:00 AM ET**)
- **Friday 7:00 AM Eastern** → create the Friday episode (intended publish **Friday 6:00 AM ET**)

Force-run creates exactly one episode: today’s slot if it is Tuesday or Friday, otherwise the next upcoming slot. Never both in one click.

Each episode has its own title, sources, and slug (e.g. `…-tue` / `…-fri`). They are not halves of one topic. Publication stays manual after approval; auto-publish stays off.

Admin controls (`/admin/podcasts`):

- Enable/disable weekly draft generation (DB setting; defaults **off**)
- Change both generation weekdays/times (Tue slot + Fri slot)
- Review/remove sources; add guide, Buzz Board question, evergreen, or custom topic
- Preview/download audio; edit title/description/show notes
- Approve & publish, reject & regenerate, schedule an approved episode
- View failures and retry
- See each episode’s intended Tuesday/Friday release day

Cron: every 15 minutes ET the server may tick `scripts/podcast-weekly-draft.js`. A run only proceeds when weekly drafts are enabled **and** the Eastern clock matches one of the two configured generate windows. Drafts are never auto-published. `auto_publish_enabled` stays false (Tuesday/Friday 6am are documented intent only).

Content priority for every weekly episode (always produces a draft):

1. Approved Florida Buzz Disney articles from the prior 7 days  
2. Relevant evergreen Florida Buzz guides  
3. Two or three public Buzz Board Disney questions (paraphrased; no invented community data)  
4. One evergreen opinion/planning topic  

Keep `PODCASTS_GENERATION_ENABLED=false` until this workflow is tested. Without it, drafts still collect sources and can generate scripts via the text AI service, but fal audio is skipped.

## Host voices (full episodes)

Gena and Diane are longtime friends — Disney-loving Central Florida moms in their mid-thirties. Geno (Gena) and Michael (Diane) may appear in family/park stories. Scripts must feel like friends exchanging stories and opinions, not presenters summarizing articles.

Every full episode outline/script should include 2–3 brief topic-linked park anecdotes with reactions/callbacks. Never invent dated news facts, wait times, closures, prices, or policies outside approved weekly sources; use timeless composites when needed.

### Drive listeners to TheFloridaBuzz.com

Hosts should naturally reference verified Florida Buzz resources (about 3–5 times per 25–35 minute episode): articles under discussion, `/guides`, `/guide/disney-world-planning`, `/dining`, `/wait-times`, `/planner`, and `/buzz`. Say “The Florida Buzz dot com” aloud — never long URLs. Explain briefly how each resource helps; vary wording; let the other host react; avoid interrupting personal/funny moments with a promo. Close with a concise reminder that articles, guides, dining, wait times, day planner, and Buzz Board live at The Florida Buzz dot com.

Show notes include a **Florida Buzz Resources Mentioned** section with direct tracked links:

`utm_source=florida_buzz_podcast&utm_medium=podcast&utm_campaign=florida_buzz_disney&utm_content=<episode-slug>`

Only promote pages/features that currently exist. Never invent guides, tools, wait times, or URLs.

Every episode’s show notes must include the unofficial Disney affiliation disclosure. Admin save appends that disclosure if missing. Do not add an AI-host disclosure to the RSS feed or show notes. Generation and publication remain manual-approval only — do not auto-generate or auto-publish.

## Admin

`/admin/podcasts` uses HTTP Basic auth with the existing `ADMIN_PASSWORD` (same pattern as `/admin/reels`).

Publishing is manual: Approve → Publish (or Schedule status only; no scheduler runs yet).
