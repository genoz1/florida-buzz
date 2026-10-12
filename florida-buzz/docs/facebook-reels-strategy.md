# Facebook strategy: park/cruise feed + inexpensive Reels

Operational note for Gene. **Website publishing is unchanged** — only Facebook distribution is filtered and spaced.

## Plain English (the important part)

**Yes — every theme-park and cruise article and guide still posts to Facebook.**  
They are just **spaced about 90 minutes apart** so the Page does not dump five posts in under an hour.

“1 per run” only means **one Facebook post per drain tick** — not “only one a day.” There are about **12 drain ticks** from 6am–10:30pm Eastern, plus automate/guide runs that also drain the queue.

**If 8 park posts publish on the site today, Facebook will post all 8, about every 1.5 hours, finishing by ~afternoon/evening the same day** (e.g. first at 6:00am → last around 4:30pm; if all eight land at noon, last around 10:30pm). Nothing is dropped — extras wait in a queue (`articles.fb_posted = false`) until the next eligible tick.

## What shipped

1. **Topic filter** — Facebook article/guide posts only for theme parks + cruises  
2. **Cadence** — ~90 min between Facebook successes; max 1 per run; **no default daily hard cap**  
3. **Queue, don’t drop** — cadence blocks leave the item queued for the next eligible run  
4. **Frequent drain** — dedicated `facebook-feed-drain` cron ~every 90 minutes Eastern so same-day volume clears  
5. **Non-park feed jobs skipped** — promo / engagement / city roundup / feature-promo Facebook posts off by default  
6. **Feed packaging** — stronger comment CTAs; link stays in first comment  
7. **Park Reel path** — article/park still photos with a slow zoom/pan + big on-screen text; not fal/guide-reels  

## Topic filter

Module: `lib/facebookDistribution.js`  
Queue helper: `lib/facebookFeedQueue.js`  
Drain script: `scripts/facebook-feed-drain.js`  
Wired into: `scripts/automate.js`, `scripts/generate-guide.js`, `server.js` drain cron

**Allowed when either:**

| Signal | Examples |
|--------|----------|
| Category | `theme-parks`, `cruises` (override with `FB_ALLOWED_CATEGORIES`) |
| Keywords in title/dek/caption/slug | disney, magic kingdom, epcot, hollywood studios, animal kingdom, universal, epic universe, seaworld, legoland, busch gardens, lightning lane, cruise, port canaveral, royal caribbean, … |

Beaches, space, wildlife, generic food/events, etc. still publish on the **website** (and other social) but **skip Facebook** (and mark the Facebook step resolved so they do not sit in the queue).

**Guides use the same gate as articles** — a theme-parks or cruises guide is queued/spaced the same way.

Disable filter (not recommended): `FB_TOPIC_FILTER_ENABLED=false`.

## Cadence defaults

| Knob | Default | Env override |
|------|---------|--------------|
| Min hours between FB successes | **1.5** (~90 min) | `FB_MIN_HOURS_BETWEEN_POSTS` (use `2` if you want slower) |
| Max FB posts per rolling 24h | **0 (off)** | `FB_MAX_POSTS_PER_DAY` — set only if you want a ceiling; blocked items still queue |
| Max FB posts per automate/guide/drain run | **1** | `FB_MAX_POSTS_PER_RUN` |
| Within-run wait after an FB post | **60** minutes | `FB_POST_DELAY_MINUTES` (only matters if max-per-run > 1) |

History comes from `post_log` (`platform=facebook`, `status=success`). If Supabase is down, cadence falls back to in-run counters only.

**Queue behavior:** park/cruise rows stay `fb_posted=false` until a successful Facebook post (or an intentional non-park skip). Dedicated drain ticks (~every 90 min, avoiding automate clock times) plus automate (6am / 11am / 3pm / 7pm ET) and guide runs (7:45am / 12:45pm / 5:45pm / 10:45pm ET) each post the oldest queued item when spacing allows.

**Why the old “3 hours + 4 automate runs” scared Gene:** with a 3h gap and only a few runs, only ~4–5 posts cleared per day and extras waited overnight — that felt like a hard cap. Defaults are now **1.5h gap + ~12 drain slots/day** so a normal park/cruise day finishes on Facebook the same day.

**Non-park Facebook jobs** (promo, engagement, city roundup FB, feature promo FB) are skipped while `FB_SKIP_NON_PARK_FEED` is not `false`. Re-enable with:

```bash
FB_SKIP_NON_PARK_FEED=false
```

## Feed packaging

`lib/socialCopy.js` → `toFacebookFeedCaption()`:

- Strips legacy “Full story ↓” suffixes  
- Adds a short yes/no or park-day question CTA when missing  
- Article URL stays in the **first comment** (`linkPlacement: 'first_comment'`)  

No hashtag dumps on Facebook.

## Daily park Reel (turn this on in production)

| Piece | Path |
|-------|------|
| Picker + slow zoom/pan render + optional publish | `lib/facebookParkReel.js` |
| CLI | `npm run facebook:park-reel` / `npm run facebook:park-reel:dry` |
| Sample (Lightning Lane, for Gene to watch) | `npm run sample:facebook-park-reel` |
| Schedule | `server.js` at **10:30am + 7:00pm ET** when enabled (+ startup / 2pm / 8pm ET catch-up if a slot was missed) |

**What each Reel looks like:** park article photo(s), camera slowly zooms/pans, **Geno ElevenLabs VO** (`eleven_v4`, voice `bg7PC2IzyIDwYgytMiW1`), and big white captions that match the spoken beats. Florida Buzz brand label. No AI host, no green screen, no wallet stickers.

**Does use:** existing article image, ffmpeg slow zoom/pan (cover-crop + `setsar=1` so landscape stills stay true 9:16), Geno TTS via `lib/visualNews/elevenTts.js`, ASS captions aligned to VO, upload to **public Supabase** `article-images/park-reels/…` for Meta’s `file_url`, Page **`/video_reels`** publish helper (not legacy `/videos`, which letterboxed vertical files in feed).  
**Does not use:** AI presenters, green-screen, fal Seedance, guide-reels worker, wallet stickers.

**Render invariants:** master is always **720×1280**, `SAR=1:1`, `DAR=9:16`. Landscape article photos are cover-cropped (no black bars). Captions are large, short-line, high-contrast — never truncated mid-sentence with `…`.

### Why a slot can miss

1. **`FB_PARK_REEL_ENABLED` / `FB_PARK_REEL_PUBLISH` not set on DigitalOcean** — without `ENABLED`, the cron never registers (startup log will say `NOT scheduled`).  
2. **Deploy landed after a slot** — crons only fire on the running process. Catch-up fills overdue slots: after 10:30am ET expects ≥1 success that Eastern day; after 7:00pm ET expects ≥2.  
3. **Local `/reels/daily/` alone** — DO disk is ephemeral; Meta needs a durable HTTPS MP4. The job now prefers a Supabase public URL.

### Code vs production secrets

| Already in code | Needs Gene in DigitalOcean / host env |
|-----------------|----------------------------------------|
| Cron slots `30 10 * * *` + `0 19 * * *` America/New_York | `FB_PARK_REEL_ENABLED=true` |
| Startup + 2pm / 8pm ET catch-up if a slot is short | `FB_PARK_REEL_PUBLISH=true` |
| Render → `public/reels/daily/*.mp4` + upload `article-images/park-reels/` | Existing `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Topic picker for park/cruise articles | Same `ELEVENLABS_API_KEY` as podcasts |
| Geno VO when `ELEVENLABS_API_KEY` is set (default on) | optional `PODCASTS_ELEVEN_VOICE_GENO=bg7PC2IzyIDwYgytMiW1` |

Code **cannot** flip DigitalOcean secrets by itself. Until those two Reel flags are set in the host, the daily Reel cron stays off (or only renders if enabled without publish). VO needs `ELEVENLABS_API_KEY` in production (set `FB_PARK_REEL_WITH_VOICE=false` only for intentional silent renders).

### Turn on in production (Gene) — exact steps

1. Deploy latest `main` (includes 10:30am + 7:00pm ET crons + catch-up + Supabase MP4 host).  
2. In DigitalOcean → App → **Settings → App-Level Environment Variables**, add/confirm:

```bash
FB_PARK_REEL_ENABLED=true
FB_PARK_REEL_PUBLISH=true
ELEVENLABS_API_KEY=<same Geno key as podcasts>
```

Keep existing `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SITE_URL=https://thefloridabuzz.com`.

3. **Save and redeploy** (or Force Rebuild). Within ~90 seconds of boot you should see either:
   - `Facebook park Reel scheduled: 10:30am + 7:00pm daily...` and then  
   - `Running Facebook park Reel catch-up (startup)` if an overdue slot is short (e.g. afternoon with 0 posts, or after 7pm with only 1), or  
   - `catch-up skipped … morning_already_posted` / `already_posted_today` when that day’s quota is filled.
4. Confirm in Runtime Logs: `Park Reel candidate:…`, `Public URL (Supabase…`, and a Facebook success / `park-reel:<slug>` in `post_log`.  
5. Optional Console one-shot (same env):

```bash
FB_PARK_REEL_PUBLISH=true npm run facebook:park-reel
```

Until step 2–3, the Reel crons are off. Until `FB_PARK_REEL_PUBLISH=true`, a scheduled job would only render. With the key present, Reels mux Geno VO and scale captions to the spoken script. Story URL goes in the first comment.

## Explicitly out of scope (still rejected)

- AI presenter / green-screen / reaction-narrator talking heads  
- fal Seedance / paid AI clip generation / `scripts/reel-worker.js` for this growth path  
- Cheap wallet / money sticker overlay dumps  
- Turning guide-reels schedules on for Facebook growth  

## Manual sample path

```bash
npm run sample:facebook-park-reel
```

Writes `florida-buzz-park-reel-sample.mp4` (and frames) under `/opt/cursor/artifacts/`. Same look as the daily path: Magic Kingdom stills, slow zoom/pan, Geno VO, captions aligned to the Lightning Lane script.

## Recommendation summary

Ship the ChatGPT plan with codebase reality: **park/cruise-only Facebook**, **every park/cruise article & guide still posts the same day**, **~90 minutes apart via queue + drain cron**, **cheap stills→video Reel daily once Gene sets the two env flags**, prove reach, then keep or kill based on plays / follows — not post count.
