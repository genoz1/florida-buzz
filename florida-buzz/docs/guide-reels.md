# Guide → Reel pipeline, Phase 1

This feature prepares a useful guide, four distinct Seedance 2.5 clips, native-speed Qwen narration, captions, one vertical master and four social drafts. It stops at `READY_FOR_APPROVAL`. Approval records a decision **only**; there is no video publisher in this feature.

## Scope and activation

The only integration with the existing app is the gated `mount(app)` call in `server.js`. Existing article/image/social code, views, schedules, gates, navigation, SEO, Buzz Board and ROOK are unchanged. New guide inserts or narrowly scoped existing-guide updates use the existing `articles` schema and article route. Original content is checkpointed in the package before an update. Existing appropriate guide images are reused; image-generation/review prompts are not changed. A missing suitable image holds the package rather than guessing or buying extra generations.

All three switches default off:

```
REELS_ENABLED=false
REELS_GENERATION_ENABLED=false
REELS_SCHEDULES_ENABLED=false
```

Do not change `AI_CONTENT_SCHEDULES_ENABLED` or other existing settings. `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `OPENAI_API_KEY` reuse existing configuration. Set the existing account's `FAL_KEY` securely; the price/balance/billing endpoints require an already-authorized admin-scope key (`FAL_BILLING_KEY`, or the same existing key). No key creation, subscriptions, credit purchases or account creation are implemented. If the existing account cannot provide those read-only billing endpoints, generation remains blocked.

Explicit positive fal media ceilings are mandatory. They default to zero, not an unlimited allowance:

```
REELS_PACKAGE_CAP_USD=2.50
REELS_DAY_CAP_USD=2.50
REELS_WEEK_CAP_USD=2.50
REELS_MONTH_CAP_USD=2.50
REELS_SHOT_SECONDS=5
REELS_CRON=0 10 * * 1,3,5
REELS_IDEAS_CRON=0 9 * * 0
```

These example ceilings are for **one controlled package**, not permission to spend or replenish the account. Every request must also fit the freshly checked existing fal balance and the configured single-generation limit. Keep schedules off for controlled repair runs. Later authorized cadence is independently configurable Monday/Wednesday/Friday 10 a.m. Eastern by default; it never starts all three together. Shot duration may be five or six seconds, producing a 20- or 24-second master. No automatic upscale or audio speed control is used.

## Schema and durable state

Apply only `supabase/migrations/202610050001_guide_reels.sql`. Do not apply other previously un-deployed migrations. It creates five new service-only tables:

- `reel_topics`: ten seeded topics, candidate scores and queue state.
- `reel_packages`: unique topic and schedule slot, guide/script/source/master/copy/review metadata.
- `reel_generations`: one immutable input/request journal per kind/shot/attempt, quoted/reserved and actual cost, result and review.
- `reel_control`: shared worker lease, fencing token and spending pause reason.
- `reel_idea_batches`: one weekly idea-generation reservation; a lost AI response is not automatically generated again.

The private `guide-reels` Storage bucket keeps the original source clips, original narration, paused narration, captions, master and approved synthetic voice embedding. No public/anonymous Storage policy is added. Admin playback uses temporary signed URLs. The six service-only RPCs claim/release/renew a lease, save active package state, reserve spending, save generation receipts/results and pause spending. No existing table or policy is altered by the migration. A partial unique index permits only one `WORKING` package globally.

## Generation and recovery

1. A worker claims the existing active package or creates one for a unique scheduled slot. It renews a ten-minute lease; all journal writes and spend reservations are fenced.
2. Live researched facts must be verified against official primary sources within the last day. Christmas-party facts require current-year pricing, dates, entry, hours, parade, fireworks, entertainment, treats, attractions and crowd limitations. Missing essential facts hold the topic before fal spending.
3. Search all existing articles in paginated batches. Reuse an adequate guide, update a same-subject stale guide while checkpointing its original, or create a substantial 800–1600-word guide with a stable topic slug. No call is made to the old guide publishing/social workflow. IndexNow receives only the guide URL through the existing helper.
4. Write four conversational thoughts, 55–65 words for 20 seconds or 64–78 for 24 seconds, with varied relevant real-location shots and direct-guide social drafts. Generic incident/manufactured news footage is disallowed.
5. Quote the approved model, check account balance and atomically reserve against package/day/week/month ceilings in Eastern time. Persist `SUBMITTING` **before** external POST. Save the returned fal request ID and URLs, then poll only that request on later worker ticks.
6. A timeout or lost receipt is ambiguous: stop at `MANUAL_REVIEW`. Never automatically POST again. Known queued requests resume after process restarts. Billing records are reconciled by request ID before another paid request. Missing billing data waits; estimates are never presented as actual charges. Unreconciled reservations continue counting against ceilings.
7. Clip review examines five ordered frames, portrait dimensions and complete duration. Classifications are `PASS`, `REGENERATE_ONCE`, `MANUAL_REVIEW`. Only a severe, clear correctable failure gets one automatic replacement; the replacement can never trigger another. Refusals and provider failures stop without wording workarounds. Frame review cannot guarantee every frame or all motion; the admin must watch the entire master before approval.
8. Qwen uses the exact stored synthetic female American voice embedding from the accepted test. It is **not** a new voice clone or voice comparison. Endpoint: `fal-ai/qwen-3-tts/text-to-speech/1.7b`; English; reference text “A lot of people get to Magic Kingdom a little later than they probably should.”; max_new_tokens 1000; top_k 50; top_p 1; temperature .9; repetition_penalty 1.05; subtalker sampling true/50/1/.9. The embedding stays in private storage; its approved checksum is configured privately as `REELS_VOICE_SHA256`. The worker checks it before any editorial or generation work and never substitutes a voice.
9. One fal Whisper request supplies word timestamps for caption sync. The audio is decoded at native speed; only safely identified quiet intervals between thoughts are replaced with 0.4/0.4/0.7 seconds. All spoken PCM samples remain unchanged. If no safe gap exists, the transcript differs, or duration fails to fit, stop for copy correction. Never time-stretch, rush, slow or regenerate the voice automatically.
10. FFmpeg makes clean cuts, burns synchronized captions and subtle Florida Buzz branding with an illustrative-footage label, maps only new narration, checks vertical/audio/duration streams, and decodes the complete master. Originals are retained. `READY_FOR_APPROVAL` is the terminal automation state.

The cost dashboard distinguishes confirmed fal charges from pending reservations. These totals cover Seedance 2.5, Qwen, Whisper and replacement requests. Seedance video-token quotes are converted from the requested 720×1280 frame area, duration and 24 fps before the paid request is reserved. Existing OpenAI editorial research and frame-review usage is billed separately by that existing provider and must also be checked in its usage dashboard; it is **not falsely included as measured fal cost**. No paid image generation is introduced. A cap violation pauses the feature globally and surfaces the reason on the held package. Resume requires an operator to review ceilings/current balance and clear `reel_control.paused_reason`; do not change ambiguous journal rows to bypass the submission guard.

## Initial topics and weekly ideas

The existing arrival proof is `EXISTING_PROOF` and skipped. Christmas-party value is the first selectable seed, followed by first-hour rides, Epic first visit, Epic costs, a different Magic Kingdom day, midday timing, Lightning Lane value, transportation timing and worst arrival time. Seeds retain their order. Weekly research starts only after a seed has been selected, reserves one idea batch, proposes ten candidates and scores hook, usefulness, relevance, visuals, clicks, discussion, verifiability, evergreen lifespan, brand fit and guide depth 1–10. Candidates below 7 on hook/usefulness/verifiability/depth are excluded. Up to three strongest diverse destinations/angles enter the queue; the other scored candidates remain saved. It may choose fewer than three rather than force weak/duplicate ideas.

## Admin and controlled test

`/admin/reels` uses the existing admin password via HTTPS Basic authentication, no URL secret. It displays cost totals, warnings and packages. Detail pages show guide URL, hook, narration, finished master, individual attempts, costs, fact sources and platform drafts. Approve/reject require an expiring signed form token and only act on ready packages. Approval does not publish. Optional manual editing/regeneration controls are intentionally deferred; they are not a back door around the one-replacement or ambiguous-request guards.

After the migration and exact existing credentials are confirmed, configure `REELS_VOICE_SHA256` from the approved original voice file. Install that original file into the private bucket once with `node scripts/reel-worker.js --install-voice /secure/path/to/approved-voice.safetensors`; it must match the configured checksum. Never commit or publicly upload the embedding. Then enable feature/generation **without schedules**, and run:

```
node scripts/reel-worker.js --start
node scripts/reel-worker.js
```

The second command advances or polls one safe step; repeat as requests finish, not with a second `--start` slot. The application can poll every minute only when schedules are deliberately enabled. Do not automatically requeue a held package. Stop with the first Christmas package ready for human review. Turn generation off after that test if ongoing cadence has not been approved.

## Validation and deployment

`npm test` includes existing regression tests, mocked paid calls, an actual embedded PostgreSQL execution of the migration/RPCs and an actual FFmpeg render/decode using synthetic fixtures. No test submits a paid generation. The tests cover all 23 requested categories, including guide reuse/new-guide creation, independent facts, model inputs, async polling, worker overlap, lost receipts, one replacement, pauses, duration, captions, actual billing, caps, authenticated approval and absence of social publishers.

Before merging/deploying, inspect the diff: only feature files, the migration/tests, required dependencies/lockfile and the two-line server hook are allowed. Deploy through the existing GitHub → DigitalOcean process after applying the new migration. Preserve all existing environment flags. Verify homepage, representative existing articles/Resources/images/Buzz Board and current schedule/social configuration. Do not publish social posts or spend image credits just to smoke-test unchanged paths. If an existing path changes unexpectedly, roll back the feature commit and disable the three feature gates; report unrelated issues instead of repairing them in this change.

**Current deployment status:** not deployed. The browser tooling exposes the separate Chrome session but not the user's signed-in in-app DigitalOcean tab; the separate DigitalOcean page was unavailable, and the Supabase dashboard requires sign-in. Production migration, credential verification, smoke tests and the one live Christmas package remain blocked. Local tests do not establish production success.


<!-- Deployment trigger: remote Reel assembly rollout -->
