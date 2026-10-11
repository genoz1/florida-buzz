# Facebook strategy: park/cruise feed + inexpensive Reels

Operational note for Gene. **Website publishing is unchanged** — only Facebook distribution is filtered and spaced.

## Plain English (the important part)

**Yes — every theme-park and cruise article and guide still posts to Facebook.**  
They are just **spaced hours apart** so the Page does not dump five posts in under an hour.

If several park/cruise pieces publish at once, the extras **wait in a queue** (`articles.fb_posted = false`) and go out on later automate/guide runs. They are **not dropped** by a tight daily cap.

## What shipped

1. **Topic filter** — Facebook article/guide posts only for theme parks + cruises  
2. **Cadence** — minimum hours between Facebook successes; max 1 per run; **no default daily hard cap**  
3. **Queue, don’t drop** — cadence blocks leave the item queued for the next eligible run  
4. **Non-park feed jobs skipped** — promo / engagement / city roundup / feature-promo Facebook posts off by default  
5. **Feed packaging** — stronger comment CTAs; link stays in first comment  
6. **Park Reel path (opt-in)** — Ken Burns + kinetic text from an article still; not fal/guide-reels  

## Topic filter

Module: `lib/facebookDistribution.js`  
Queue helper: `lib/facebookFeedQueue.js`  
Wired into: `scripts/automate.js`, `scripts/generate-guide.js`

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
| Min hours between FB successes | **3** | `FB_MIN_HOURS_BETWEEN_POSTS` |
| Max FB posts per rolling 24h | **0 (off)** | `FB_MAX_POSTS_PER_DAY` — set only if you want a ceiling; blocked items still queue |
| Max FB posts per automate/guide run | **1** | `FB_MAX_POSTS_PER_RUN` |
| Within-run wait after an FB post | **60** minutes | `FB_POST_DELAY_MINUTES` (was 10) |

History comes from `post_log` (`platform=facebook`, `status=success`). If Supabase is down, cadence falls back to in-run counters only.

**Queue behavior:** park/cruise rows stay `fb_posted=false` until a successful Facebook post (or an intentional non-park skip). Each automate run (6am / 11am / 3pm / 7pm ET) and guide run (7:45am / 12:45pm / 5:45pm / 10:45pm ET) drains the oldest queued item first when spacing allows.

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

## Park Reel path (opt-in — not live until you flip flags)

| Piece | Path |
|-------|------|
| Picker + Ken Burns render + optional publish | `lib/facebookParkReel.js` |
| CLI | `npm run facebook:park-reel` / `npm run facebook:park-reel:dry` |
| Schedule | `server.js` at **10:15am ET** when enabled |

**Does use:** existing article image, ffmpeg Ken Burns, kinetic ASS captions, Page `/videos` upload helper.  
**Does not use:** AI presenters, green-screen, fal Seedance, guide-reels worker, wallet stickers.

### Turn on in production (Gene)

1. Deploy this branch (includes the `fb_posted` backfill migration so old articles are not re-queued).  
2. Confirm article automate + guides still write to the site (no env change required for the filter — it is on by default).  
3. Optional cadence tweaks on the host, e.g.:

```bash
FB_MIN_HOURS_BETWEEN_POSTS=3
# Leave FB_MAX_POSTS_PER_DAY unset (or 0) so park/cruise volume is not hard-capped.
FB_MAX_POSTS_PER_RUN=1
```

4. **Manual Reel dry run** (render only):

```bash
DRY_RUN=true npm run facebook:park-reel
```

5. Confirm the MP4 is under `public/reels/daily/` and reachable at  
   `https://thefloridabuzz.com/reels/daily/<file>.mp4` after deploy/sync.  
6. **Publish one Reel**:

```bash
FB_PARK_REEL_PUBLISH=true npm run facebook:park-reel
```

7. **Schedule daily render/publish** (host env):

```bash
FB_PARK_REEL_ENABLED=true
FB_PARK_REEL_PUBLISH=true   # only after a successful manual publish
```

Until step 7, the daily cron is off. Until `FB_PARK_REEL_PUBLISH=true`, a scheduled job would only render.

Meta still receives a **Page video** via `/{page-id}/videos` (same helper as before). That is good enough for discovery testing; dedicated Facebook Reels Graph placement can be layered later. Put the article URL in the first comment (already wired).

## Explicitly out of scope (still rejected)

- AI presenter / green-screen / reaction-narrator talking heads  
- fal Seedance / paid AI clip generation / `scripts/reel-worker.js` for this growth path  
- Cheap wallet / money sticker overlay dumps  
- Turning guide-reels schedules on for Facebook growth  

## Manual sample path (still valid)

```bash
ELEVENLABS_API_KEY=… npm run sample:disney-story
```

Upload the MP4 manually to Facebook Reels if you want a human QA pass before enabling `FB_PARK_REEL_PUBLISH`.

## Recommendation summary

Ship the ChatGPT plan with codebase reality: **park/cruise-only Facebook**, **every park/cruise article & guide still posts**, **spaced hours apart via queue**, **cheap stills→video Reel opt-in**, prove reach, then keep or kill based on plays / follows — not post count.
