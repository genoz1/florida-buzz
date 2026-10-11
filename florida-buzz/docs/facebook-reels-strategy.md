# Facebook strategy: Disney article → inexpensive Reels

Operational note for Gene (recommendation + codebase feasibility). **No publishing automation is changed by this doc.**

## Verdict

**Yes — prioritize article → short Reels on Facebook.** Keep website publishing. Treat regular Facebook article/photo link posts as secondary (or pause most of them) until Reels prove reach. Do **not** flood the Page with every article.

ChatGPT’s Meta read (~61 followers; article posts ~0–3 impressions; promo Reels ~100–150 views) matches what the product should optimize for: short vertical video, not feed link spam.

## Cadence (7-day test)

| Channel | Action |
|--------|--------|
| Website | Keep automate / guides as today |
| Facebook Reels | **1 short Disney Reel/day** (manual first, then automate) |
| Facebook article/photo posts | **Stop bursts.** At most 0–1 spaced feed posts/day during the test, or pause |
| Promo / engagement FB posts | Keep only if they are already video-style winners; otherwise hold |
| Buzz Board opinion social | Already paused by default — leave paused |
| Guide-reels (fal Seedance) | Stay **off** — wrong product for this test |

Article bursts happen because `scripts/automate.js` can publish multiple new items per run with only `FB_POST_DELAY_MINUTES` (default **10**) between posts, and `server.js` schedules automate **4×/day** plus guides, promos, etc. That spacing is “within one run,” not a healthy daily Page cadence.

## Feasibility in Florida Buzz: **partial → yes with modest work**

### Already built

| Piece | Where | Notes |
|------|--------|------|
| Facebook Page photo/link posts | `lib/facebook.js`, `scripts/automate.js`, `scripts/generate-guide.js` | Works; link in first comment |
| Facebook **video** upload | `lib/facebook.js` → `POST /{page-id}/videos` | Page video, **not** the dedicated Facebook Reels publish API |
| Instagram Reels publish | `lib/instagram.js` (`media_type: 'REELS'`) | Real Reels container flow |
| Guide → paid AI Reel pipeline | `lib/reels/*`, `docs/guide-reels.md` | fal Seedance + Qwen; **disabled** (emergency quality hold); stops at approval; auto-publish gated |
| Cheap vertical video samples | `lib/visualNews/*`, `npm run sample:visual-news-ll`, `npm run sample:disney-story` | Ken Burns / stills + ASS captions + ElevenLabs; **no fal** |
| Social schedules / flags | `lib/scheduleConfig.js`, `server.js` | Article, guide, promo, engagement, Buzz Board knobs |

### Not built yet (needed for auto Disney article → FB Reels)

1. **Article picker** — choose 1 Disney/theme-park story/day (not every RSS hit).
2. **Script + caption beats from the article** — short hook VO or kinetic text only; reuse existing images.
3. **Production path that is not fal Seedance** — extend `lib/visualNews` (or disney-story sample) to take live article stills.
4. **Public video URL** — Meta `file_url` needs a reachable HTTPS URL (host/upload step).
5. **Facebook Reels-specific publish** (optional but preferred) — today’s helper posts Page video; Instagram already has Reels. Confirm whether Page `/videos` is enough or wire Meta’s Reels publishing.
6. **Separate 1/day schedule + receipts** — do not bolt onto the multi-article automate loop.

Modest work: reuse visual-news ffmpeg + existing FB/IG credentials; add picker + publish + cadence. Not a greenfield video product.

## Explicitly out of scope (already rejected)

- AI presenter / green-screen / reaction-narrator talking heads  
- fal Seedance / paid AI clip generation for this growth test  
- Cheap wallet / money sticker overlay dumps that failed visual-news review  
- Turning guide-reels schedules on for Facebook growth  

## Manual test path (use now)

Inexpensive Disney-style vertical samples (no fal):

```bash
# Ken Burns + captions + ElevenLabs VO (hardcoded Magic Kingdom story)
ELEVENLABS_API_KEY=… npm run sample:disney-story

# Visual-news Lightning Lane sample (stills + captions + Geno VO; no presenter)
ELEVENLABS_API_KEY=… npm run sample:visual-news-ll
```

Upload the MP4 **manually** to Facebook Reels for 3 stories over a few days. Caption: hook + soft CTA; put the article URL in the **first comment**, not only in the Reel (Meta often suppresses outbound links in video).

Do **not** use `node scripts/reel-worker.js` / guide-reels for this test (paid fal path, gates off, quality hold).

## Phased plan

1. **Manual 3** — Three Disney article Reels from existing images + ken-burns/kinetic text (or the sample scripts above). Measure 48h reach/followers vs article posts.
2. **Automate 1/day** — Wire visual-news-style render → public URL → FB (and optionally IG Reels). Hard cap one Reel/day. Throttle or skip FB article flooding.
3. **Metrics (7 days)** — Reel plays, 3-second views, follows from Reels, profile visits, link clicks from first comment, vs residual article-post impressions. Kill or keep based on that, not vanity post count.

## Risks

- **Links in Reel captions** — often weak distribution; prefer first comment + on-site CTA in video.  
- **Instagram** — Reels API is ready if tokens are set; Facebook Page video ≠ guaranteed Reels tab placement until confirmed.  
- **Volume penalties** — continuing 4×/day article automate + guides + promos will keep burying the Page while testing Reels.  
- **ElevenLabs cost** — cheap vs fal video, still metered; one short VO/day is fine.  
- **Image rights** — prefer article-owned / already-published stills; sample refs under `public/reels/references/` are for samples only.

## Recommendation summary

Ship the ChatGPT plan with a codebase-aligned twist: **yes to article→Reels**, **use the existing cheap stills+ffmpeg path (not guide-reels/fal)**, **stop Facebook article flooding during the test**, prove with 3 manuals, then automate one Reel per day.
