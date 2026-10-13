# Facebook strategy: full feed + inexpensive park Reels

Operational note for Gene. **Website publishing is unchanged** — Facebook distribution is spaced so the Page does not dump a burst of posts.

## Plain English (the important part)

**Yes — every article and guide posts to Facebook.**  
They are **spaced about every 30 minutes** so the Page does not dump several posts in under an hour.

“1 per run” only means **one Facebook post per drain tick** — not “only one a day.” There are drain ticks about every **30 minutes** from 7am–11pm Eastern, plus automate/guide runs that also drain the queue.

**If ~16 articles publish on the site today, Facebook will post them about every 30 minutes across the waking day.** Nothing is dropped — extras wait in a queue (`articles.fb_posted = false`) until the next eligible tick.

## What shipped

1. **Full feed** — every article and guide can post to Facebook (optional park/cruise filter is off by default)  
2. **Cadence** — ~30 min between Facebook successes; max 1 per run; **no default daily hard cap**  
3. **Queue, don’t drop** — cadence blocks leave the item queued for the next eligible run  
4. **Frequent drain** — dedicated `facebook-feed-drain` cron ~every 30 minutes Eastern so same-day volume clears  
5. **Promo / engagement / city** — allowed on Facebook again by default  
6. **Feed packaging** — stronger comment CTAs; link stays in first comment  
7. **Park Reel path** — still park/cruise-only; article/park still photos with a slow zoom/pan + captions  

## Topic filter (optional)

Module: `lib/facebookDistribution.js`  
Queue helper: `lib/facebookFeedQueue.js`  
Drain script: `scripts/facebook-feed-drain.js`  
Wired into: `scripts/automate.js`, `scripts/generate-guide.js`, `server.js` drain cron

**Default: filter off** (`FB_TOPIC_FILTER_ENABLED` unset/false) — beaches, wildlife, food, events, space, etc. all post to Facebook with the same spacing queue.

To re-enable park/cruise-only feed posts:

```bash
FB_TOPIC_FILTER_ENABLED=true
```

When that flag is on, allowed when either:

| Signal | Examples |
|--------|----------|
| Category | `theme-parks`, `cruises` (override with `FB_ALLOWED_CATEGORIES`) |
| Keywords in title/dek/caption/slug | disney, magic kingdom, epcot, hollywood studios, animal kingdom, universal, epic universe, seaworld, legoland, busch gardens, lightning lane, cruise, port canaveral, royal caribbean, … |

**Park Reels always stay park/cruise-only** via `isParkCruiseTopic()`, even when the feed filter is off.

## Cadence defaults

| Knob | Default | Env override |
|------|---------|--------------|
| Min hours between FB successes | **0.5** (~30 min) | `FB_MIN_HOURS_BETWEEN_POSTS` (use `1` if you want slower) |
| Max FB posts per rolling 24h | **0 (off)** | `FB_MAX_POSTS_PER_DAY` — set only if you want a ceiling; blocked items still queue |
| Max FB posts per automate/guide/drain run | **1** | `FB_MAX_POSTS_PER_RUN` |
| Within-run wait after an FB post | **60** minutes | `FB_POST_DELAY_MINUTES` (only matters if max-per-run > 1) |

History comes from `post_log` (`platform=facebook`, `status=success`). If Supabase is down, cadence falls back to in-run counters only.

**Queue behavior:** article/guide rows stay `fb_posted=false` until a successful Facebook post. Dedicated drain ticks (~every 30 min, avoiding automate clock times) plus automate (6am / 11am / 3pm / 7pm ET) and guide runs (7:45am / 12:45pm / 5:45pm / 10:45pm ET) each post the oldest queued item when spacing allows.

**Why ~30 minutes:** that is about the widest gap that still clears a normal full-day article + guide volume without dumping several posts at once. Wider gaps (1–1.5h) build a multi-day backlog when the site publishes ~40 pieces/day.

**Non-article Facebook jobs** (promo, engagement, city roundup FB, feature promo FB) are allowed by default. Skip them with:

```bash
FB_SKIP_NON_PARK_FEED=true
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
| Schedule | `server.js` at **10:30am tip + 7:00pm Disney news ET** when enabled (+ startup / 2pm / 8pm ET catch-up if a slot was missed) |

**Morning (10:30am ET) — theme-park tip:** prefers evergreen **guides** and tips/tricks. VO opens with the park name — e.g. “Here's another Disney tip from The Florida Buzz.”  

**Evening (7:00pm ET) — Disney news:** prefers recent non-evergreen **Disney** stories. VO opens with “Here's the latest Disney news from The Florida Buzz.”  

Same render path either way: still photo, slow zoom/pan, Geno VO, mute-friendly captions, Supabase MP4 host, `/video_reels` publish, story link in first comment. No AI host / fal / wallet stickers.

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
| Cron `30 10` tip + `0 19` Disney news (America/New_York) | `FB_PARK_REEL_ENABLED=true` |
| Startup + 2pm / 8pm ET catch-up (correct mode per missed slot) | `FB_PARK_REEL_PUBLISH=true` |
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
   - `Facebook park Reel scheduled: 10:30am tip + 7:00pm Disney news...` and then  
   - `Running Facebook park Reel catch-up (startup) … mode=tip|disney-news` if an overdue slot is short, or  
   - `catch-up skipped … morning_already_posted` / `already_posted_today` when that day’s quota is filled.
4. Confirm in Runtime Logs: `Park Reel candidate [mode]…`, `Opener:…`, `Public URL (Supabase…`, and `park-reel:<mode>:<slug>` in `post_log`.  
5. **Manual test — use the admin URL, not DigitalOcean Console.**  
   Console sandboxes often die mid-ffmpeg (`WaitPID EOF`) even when production is fine. Open (replace `YOUR_ADMIN_PASSWORD`):

```text
https://thefloridabuzz.com/admin/facebook-park-reel?key=YOUR_ADMIN_PASSWORD&mode=tip
https://thefloridabuzz.com/admin/facebook-park-reel?key=YOUR_ADMIN_PASSWORD&mode=disney-news
```

Dry run (no Meta post): add `&dryRun=true`. Then watch **Runtime Logs** (not Console) for `Park Reel candidate…` → `Public URL (Supabase…` → run complete. Success also shows in `post_log` as `park-reel:<mode>:<slug>`.

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

Ship with codebase reality: **every article & guide posts to Facebook**, **~30 minutes apart via queue + drain cron**, **park Reels stay park/cruise-only**, prove reach, then keep or kill based on plays / follows — not post count.
