require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { logNotFound } = require('./lib/notFoundLog');
const { createScheduledRunner } = require('./lib/scheduledRun');
const { getScheduleFlags, parseBuzzFacebookSlots, FACEBOOK_FEED_DRAIN_CRONS } = require('./lib/scheduleConfig');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Private reader-authentication foundation. Disabled by default and deliberately
// not linked from the public site. Enabling it requires all server-side security
// configuration to validate at startup; production also requires Turnstile.
if (process.env.READER_AUTH_ENABLED === 'true') {
  app.set('trust proxy', 1);
  const { createAuthRouter, createProductionAuthFoundation } = require('./lib/auth');
  const authFoundation = createProductionAuthFoundation(process.env);
  app.use('/internal/auth', createAuthRouter(authFoundation));
  console.log('Private reader authentication endpoints enabled.');
  if (process.env.BUZZ_BOARD_ENABLED === 'true') {
    const { supabase } = require('./lib/supabase');
    const { createProductionCommunityRouter } = require('./lib/community');
    app.use('/buzz', createProductionCommunityRouter({ client: supabase, authFoundation, env: process.env }));
    console.log('Private Buzz Board routes enabled.');
  }
}

// IndexNow key verification file — must be served at the site root with a
// filename matching the key itself, containing just the key as plain text.
// This is how Bing/IndexNow confirms you actually control this domain.
if (process.env.INDEXNOW_KEY) {
  app.get(`/${process.env.INDEXNOW_KEY}.txt`, (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(process.env.INDEXNOW_KEY);
  });
}

// If this app is reached via genezentko.com (a personal domain pointed at
// this same DigitalOcean app to avoid paying for separate hosting), serve
// a standalone personal bio page instead of the normal Florida Buzz routes.
const GENEZENTKO_HOSTS = ['genezentko.com', 'www.genezentko.com'];
const GENEZENTKO_PAGES = {
  '/': 'genezentko-standalone',
  '/career-journey': 'genezentko-career',
  '/why-i-build-businesses': 'genezentko-ventures',
  '/resume': 'genezentko-resume',
  '/do-what-you-say': 'genezentko-philosophy',
  '/insights/building-relationships-healthcare-sales': 'genezentko-relationships',
  '/insights/physician-sales-vs-veterinary-sales': 'genezentko-physician-vs-vet',
  '/insights/territory-management-healthcare-sales': 'genezentko-territory',
  '/insights/growing-laboratory-diagnostics-territory': 'genezentko-lab-growth',
  '/insights/solving-problems-not-selling-products': 'genezentko-solving-problems',
  '/insights/features-tell-benefits-sell': 'genezentko-features-benefits',
  '/insights/people-buy-emotionally-justify-logically': 'genezentko-emotional-logical',
  '/profiles': 'genezentko-profiles',
};
app.use((req, res, next) => {
  if (GENEZENTKO_HOSTS.includes(req.hostname)) {
    if (req.path === '/sitemap.xml') {
      // Auto-generated from GENEZENTKO_PAGES above — every page added there
      // automatically appears here too, so this can never drift out of sync.
      const urls = Object.keys(GENEZENTKO_PAGES)
        .map((path) => `  <url><loc>https://genezentko.com${path === '/' ? '' : path}</loc></url>`)
        .join('\n');
      res.set('Content-Type', 'application/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
    }
    const view = GENEZENTKO_PAGES[req.path];
    if (view) return res.render(view);
    return res.status(404).send('Not found');
  }
  next();
});

// Independent additive feature; disabled by default, with no social publishing.
require('./lib/reels').mount(app);
// Independent additive podcast feature (public on; generation off unless flagged).
require('./lib/podcasts').mount(app);
app.use('/', require('./routes/main'));

app.use((req, res) => {
  logNotFound(req.originalUrl, req.get('referer'));
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`The Florida Buzz running on port ${PORT}`);
  checkAndResumeImageReprocessing();
});

// Checks on every boot whether the image reprocessing job still has real work
// left, and if so, launches it automatically. Combined with the fact that
// DigitalOcean already auto-restarts this app within seconds of any crash,
// this turns "the job crashed on an unknown bad file" into a fully
// self-healing loop: crash -> platform auto-restart -> this check fires ->
// job resumes automatically -> repeat as needed -> no one has to be awake
// watching it or re-clicking anything. The job itself remembers (via a state
// file in Supabase Storage, not local disk, so it survives a restart) which
// specific file it was working on when a crash happened, and permanently
// skips that one on the next attempt.
async function checkAndResumeImageReprocessing() {
  if (process.env.AUTO_RESUME_IMAGE_REPROCESSING !== 'true') return;
  try {
    console.log('Startup check: AUTO_RESUME_IMAGE_REPROCESSING is on — launching the reprocessing job to check for and continue any remaining work.');
    const { spawn } = require('child_process');
    const child = spawn('node', [path.join(__dirname, 'scripts', 'reprocess-images.js')], {
      detached: true,
      stdio: 'inherit',
    });
    child.unref();
  } catch (err) {
    console.error('Startup image-reprocessing check failed (non-fatal, site continues normally):', err.message);
  }
}

// Prevents the same scheduled command from starting again while its previous
// invocation is still running. The scheduler itself is unchanged; this is a
// small in-process guard around its existing child-process launches.
const { runScheduledCommand } = createScheduledRunner({ cwd: __dirname });
const scheduleFlags = getScheduleFlags(process.env);

// Runs the RSS -> AI -> publish -> post pipeline automatically, 4x/day.
// Adjust the cron schedule once you've confirmed costs/volume feel right.
// AI schedules are fail-closed: both the explicit production gate and the
// provider credentials must be present. An API key by itself never starts them.
if (scheduleFlags.articleAutomation) {
  cron.schedule('0 6,11,15,19 * * *', () => {
    console.log('Running scheduled automation...');
    runScheduledCommand('article automation', 'node scripts/automate.js');
  }, { timezone: 'America/New_York' });
  console.log('Automation scheduled: 6am, 11am, 3pm, 7pm daily (Eastern time).');
} else {
  console.log('Automation NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and OPENAI_API_KEY must be set.');
}

// Generates new evergreen guides (web-search-grounded research, then writes,
// images, and posts them), 4x/day, so the daily newsletter and /guides page
// keep getting fresh reference content alongside the news items. Spaced away
// from the article automation and promo post times above. Disabled until
// OPENAI_API_KEY is set.
if (scheduleFlags.evergreenGuides) {
  cron.schedule('45 7,12,17,22 * * *', () => {
    console.log('Running scheduled evergreen guide generation...');
    runScheduledCommand('evergreen guide generation', 'node scripts/generate-guide.js');
  }, { timezone: 'America/New_York' });
  console.log('Evergreen guide generation scheduled: 7:45am, 12:45pm, 5:45pm, and 10:45pm daily (Eastern time).');
} else {
  console.log('Evergreen guide generation NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and OPENAI_API_KEY must be set.');
}

// Sends the daily digest every day at 8am. Disabled until RESEND_API_KEY is set.
// NOTE: daily sending is currently blocked upstream by the Wix-to-Cloudflare
// domain transfer needed for MX records / Resend domain verification — this
// schedule is set correctly now so it's already right once that unblocks.
if (scheduleFlags.newsletter) {
  cron.schedule('0 8 * * *', () => {
    console.log('Running scheduled newsletter send...');
    runScheduledCommand('newsletter send', 'node scripts/newsletter.js');
  }, { timezone: 'America/New_York' });
  // Welcome nurture follow-ups (days 2/4/7) — soft secondary to the daily digest.
  cron.schedule('15 9 * * *', () => {
    console.log('Running scheduled welcome nurture...');
    runScheduledCommand('welcome nurture', 'node scripts/welcome-nurture.js');
  }, { timezone: 'America/New_York' });
  console.log('Newsletter scheduled: daily at 8am (Eastern time).');
  console.log('Welcome nurture scheduled: daily at 9:15am (Eastern time).');
} else {
  console.log('Newsletter NOT scheduled — set RESEND_API_KEY to enable.');
}

// Posts a promotional (non-article) message to the Facebook Page twice a day,
// rotating between: general brand awareness, newsletter signup, and a random
// evergreen guide highlight. Spaced away from the article posting times above.
// Disabled until FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN are set.
if (scheduleFlags.standardPromo) {
  cron.schedule('0 9,20 * * *', () => {
    console.log('Running scheduled promo post...');
    runScheduledCommand('standard promo post', 'node scripts/promo-post.js');
  }, { timezone: 'America/New_York' });
  console.log('Promo posts scheduled: 9am and 8pm daily (Eastern time).');
} else {
  console.log('Promo posts NOT scheduled — set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN to enable.');
}

// Posts a "what to do this week/weekend" roundup for each of the 4 city pages
// to Facebook only — never saved as an article on the site. Monday runs the
// "this week" version, Friday runs the "this weekend" version (the script
// itself checks which day it is; the cron day-of-week filter here is a second
// layer so it doesn't even fire on other days). Disabled until FB_PAGE_ID and
// FB_PAGE_ACCESS_TOKEN are set.
if (scheduleFlags.cityRoundups) {
  cron.schedule('0 10 * * 1,5', () => {
    console.log('Running scheduled city roundup...');
    runScheduledCommand('city roundup', 'node scripts/city-roundup.js');
  }, { timezone: 'America/New_York' });
  console.log('City roundups scheduled: Mondays and Fridays at 10am (Eastern time).');
} else {
  console.log('City roundups NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and the OpenAI/Facebook variables must be set.');
}

// Posts one lightweight "vote in the comments" engagement post per day to
// Facebook — separate from news, guides, and promo content. Starting at
// ONE per day deliberately (not the 10/day some tools suggest) since the
// Page is still small; scale this up later only if it's clearly working.
// Spaced away from every other scheduled post above. Disabled until
// OPENAI_API_KEY, FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN are set.
if (scheduleFlags.engagementPosts) {
  cron.schedule('30 13 * * *', () => {
    console.log('Running scheduled engagement post...');
    runScheduledCommand('engagement post', 'node scripts/engagement-post.js');
  }, { timezone: 'America/New_York' });
  console.log('Engagement post scheduled: 1:30pm daily (Eastern time).');
} else {
  console.log('Engagement post NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and the OpenAI/Facebook variables must be set.');
}

// Facebook receives spaced conversation posts. Instagram remains at one daily
// Buzz Board post so it complements, rather than floods, the existing article
// feed. Selection is deterministic and protected by platform-specific cooldowns
// in scripts/buzz-board-social.js.
// Optional cadence knob: BUZZ_FACEBOOK_SLOTS=morning,afternoon,evening (default)
// e.g. BUZZ_FACEBOOK_SLOTS=morning,evening to post twice/day only.
if (scheduleFlags.buzzBoardSocial) {
  const facebookBuzzSlots = parseBuzzFacebookSlots(process.env.BUZZ_FACEBOOK_SLOTS);
  for (const entry of facebookBuzzSlots) {
    cron.schedule(entry.cron, () => {
      console.log(`Running scheduled Facebook Buzz Board post (${entry.slot})...`);
      runScheduledCommand(
        `Facebook Buzz Board post: ${entry.slot}`,
        `SOCIAL_PLATFORM=facebook BUZZ_SOCIAL_SLOT=${entry.slot} node scripts/buzz-board-social.js`
      );
    }, { timezone: 'America/New_York' });
  }
  cron.schedule('30 21 * * *', () => {
    console.log('Running scheduled Instagram Buzz Board post...');
    runScheduledCommand(
      'Instagram Buzz Board post',
      'SOCIAL_PLATFORM=instagram BUZZ_SOCIAL_SLOT=daily node scripts/buzz-board-social.js'
    );
  }, { timezone: 'America/New_York' });
  const fbLabels = facebookBuzzSlots.map((entry) => entry.label).join(', ') || '(none)';
  console.log(`Facebook Buzz Board distribution scheduled: ${fbLabels} daily (Eastern time).`);
  console.log('Instagram Buzz Board distribution scheduled: 9:30pm daily (Eastern time).');
} else {
  console.log('Buzz Board opinion social posts NOT scheduled — paused while short-form video is the engagement focus. Set BUZZ_BOARD_SOCIAL_ENABLED=true and BUZZ_BOARD_OPINION_SOCIAL_ENABLED=true to resume.');
}

// Repairs a small bounded number of image jobs each night. Technical review
// failures keep and re-review the same stored candidate; they do not purchase
// another generation. The queue survives deploys and provider outages.
if (scheduleFlags.imageRepair) {
  cron.schedule('30 2 * * *', () => {
    console.log('Running bounded article image repair batch...');
    runScheduledCommand(
      'article image repair',
      'APPLY_IMAGE_REPAIR=true PRODUCTION_IMAGE_REPAIR_APPROVED=true VERIFY_IMAGE_BYTES=false node scripts/repair-article-images.js'
    );
  }, { timezone: 'America/New_York' });
  console.log('Article image repair scheduled: 2:30am daily (Eastern time), bounded by IMAGE_REPAIR_GENERATION_LIMIT.');
} else {
  console.log('Article image repair NOT scheduled — enable AI schedules and configure OpenAI/Supabase.');
}

// Low-frequency reconciliation complements the signed Meta Page webhook and
// recovers missed comment edits/removals without continuously polling Meta.
if (scheduleFlags.facebookBuzzCommentSync) {
  cron.schedule('20 */6 * * *', () => {
    console.log('Running scheduled Facebook Buzz comment reconciliation...');
    runScheduledCommand('Facebook Buzz comment reconciliation', 'node scripts/sync-facebook-buzz-comments.js');
  }, { timezone: 'America/New_York' });
  console.log('Facebook Buzz comment reconciliation scheduled: every 6 hours at :20 (Eastern time).');
} else {
  console.log('Facebook Buzz comment reconciliation NOT scheduled — enable it after Meta comment-read access is granted.');
}

// Sends a daily email confirming whether every platform (Facebook, Instagram,
// Pinterest, Threads) posted successfully in the last 24 hours — a genuine
// pass/fail confirmation, not just an alert-on-failure. Runs at 8:15am,
// after the prior day's full posting cycle has completed. Disabled until
// RESEND_API_KEY and ALERT_EMAIL_TO are set.
// Sends a daily email confirming whether every platform (Facebook, Instagram,
// Pinterest, Threads) posted successfully in the last 24 hours — a genuine
// pass/fail confirmation, not just an alert-on-failure. Runs at 8:15am,
// after the prior day's full posting cycle has completed. Disabled until
// RESEND_API_KEY and ALERT_EMAIL_TO are set.
if (scheduleFlags.postHealthCheck) {
  cron.schedule('15 8 * * *', () => {
    console.log('Running scheduled post health check...');
    runScheduledCommand('post health check', 'node scripts/post-health-check.js');
  }, { timezone: 'America/New_York' });
  console.log('Post health check scheduled: 8:15am daily (Eastern time).');
} else {
  console.log('Post health check NOT scheduled — set RESEND_API_KEY and ALERT_EMAIL_TO to enable.');
}

// Refreshes the dining directory (scripts/generate-dining-directory.js) once
// a month for each park it currently covers — restaurants close, menus
// change, and dining plan status shifts often enough that a static one-time
// list would go stale. Runs on the 1st of each month. NOTE: since this
// replaces a park's entire restaurant list in one shot rather than updating
// individual entries, it's worth occasionally spot-checking the live page
// after a refresh rather than assuming it's always perfect — add new park
// slugs to the list below as you add them to DINING_PARK_LABELS in
// routes/main.js. Disabled until OPENAI_API_KEY is set.
const DINING_DIRECTORY_PARKS = ['magic-kingdom', 'epcot', 'hollywood-studios', 'animal-kingdom', 'resorts'];

if (scheduleFlags.diningDirectoryResearch) {
  cron.schedule('0 5 1 * *', () => {
    DINING_DIRECTORY_PARKS.forEach((park) => {
      console.log(`Running scheduled dining directory refresh for ${park}...`);
      runScheduledCommand(
        `dining directory refresh: ${park}`,
        `PARK=${park} node scripts/generate-dining-directory.js`
      );
    });
  }, { timezone: 'America/New_York' });
  console.log(`Dining directory refresh scheduled: 1st of each month at 5am (Eastern time), covering: ${DINING_DIRECTORY_PARKS.join(', ')}.`);
} else {
  console.log('Dining directory refresh NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and OPENAI_API_KEY must be set.');
}

// Promotes the site's own tools (wait times, dining directories) rather than
// a specific article — one post per topic per day, each to all 4 platforms,
// with a fresh AI-written caption every time but a reused cached image (see
// scripts/promo-feature-post.js). Spaced well away from every other
// scheduled post above. Disabled until OPENAI_API_KEY,
// FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN are all set.
if (scheduleFlags.featurePromoCaptions) {
  cron.schedule('30 12 * * *', () => {
    console.log('Running scheduled wait-times promo post...');
    runScheduledCommand('wait-times feature promo', 'TOPIC=wait-times node scripts/promo-feature-post.js');
  }, { timezone: 'America/New_York' });

  cron.schedule('30 16 * * *', () => {
    console.log('Running scheduled dining promo post...');
    runScheduledCommand('dining feature promo', 'TOPIC=dining node scripts/promo-feature-post.js');
  }, { timezone: 'America/New_York' });

  console.log('Feature promo posts scheduled: wait-times at 12:30pm, dining at 4:30pm daily (Eastern time).');
} else {
  console.log('Feature promo posts NOT scheduled — AI_CONTENT_SCHEDULES_ENABLED must be true and the OpenAI/Facebook variables must be set.');
}

// Florida Buzz Disney podcast weekly draft tick (America/New_York).
// Creates review drafts only — never publishes. Actual runs require the admin
// "Enable weekly draft generation" toggle. Audio still requires
// PODCASTS_GENERATION_ENABLED=true (keep false until tested).
const podcastsCfg = require('./lib/podcasts').config(process.env);
if (podcastsCfg.enabled && podcastsCfg.weeklyCron) {
  cron.schedule(
    '*/15 * * * *',
    () => {
      console.log('Checking Florida Buzz podcast weekly draft schedule...');
      runScheduledCommand('podcast weekly draft', 'node scripts/podcast-weekly-draft.js');
    },
    { timezone: 'America/New_York' }
  );
  console.log(
    'Podcast weekly draft checker scheduled every 15 minutes ET (runs only when admin weekly drafts are enabled; no auto-publish).'
  );
} else {
  console.log('Podcast weekly draft checker NOT scheduled — podcasts disabled or PODCASTS_WEEKLY_CRON_ENABLED=false.');
}

// Twice-daily park Reels: 10:30am tip/guide + 7:00pm Disney news.
// Cron on when FB_PARK_REEL_ENABLED=true (+ FB + Supabase). Actual Meta publish
// also needs FB_PARK_REEL_PUBLISH=true (otherwise the job only renders).
if (scheduleFlags.facebookParkReel) {
  const {
    PARK_REEL_MODE_DISNEY_NEWS,
    PARK_REEL_MODE_TIP,
    shouldRunParkReelCatchUp,
  } = require('./lib/facebookParkReel');
  const { supabase: parkReelSupabase } = require('./lib/supabase');

  function parkReelCommand(mode) {
    return `FB_PARK_REEL_MODE=${mode} node scripts/facebook-park-reel.js`;
  }

  async function maybeCatchUpParkReel(reason) {
    try {
      const decision = await shouldRunParkReelCatchUp(parkReelSupabase);
      if (!decision.run) {
        console.log(
          `Facebook park Reel catch-up skipped (${reason}): ${decision.reason}`
          + ` (posted ${decision.posted}/${decision.expected} today ET)`
        );
        return;
      }
      const mode = decision.mode || PARK_REEL_MODE_TIP;
      console.log(
        `Running Facebook park Reel catch-up (${reason}) — missed ${decision.label || 'slot'}`
        + ` mode=${mode} (posted ${decision.posted}/${decision.expected} today ET)...`
      );
      runScheduledCommand('facebook park reel', parkReelCommand(mode));
    } catch (err) {
      console.error(`Facebook park Reel catch-up failed (${reason}):`, err.message || err);
    }
  }

  // 10:30am Eastern — theme-park tip / guide Reel.
  cron.schedule('30 10 * * *', () => {
    console.log('Running scheduled Facebook park Reel (10:30am ET tip)...');
    runScheduledCommand('facebook park reel', parkReelCommand(PARK_REEL_MODE_TIP));
  }, { timezone: 'America/New_York' });

  // 7:00pm Eastern — Disney news Reel.
  cron.schedule('0 19 * * *', () => {
    console.log('Running scheduled Facebook park Reel (7:00pm ET Disney news)...');
    runScheduledCommand('facebook park reel', parkReelCommand(PARK_REEL_MODE_DISNEY_NEWS));
  }, { timezone: 'America/New_York' });

  // Safety nets if a cron tick or redeploy missed a slot (morning → 2pm, evening → 8pm).
  cron.schedule('0 14 * * *', () => {
    maybeCatchUpParkReel('14:00 ET morning safety');
  }, { timezone: 'America/New_York' });
  cron.schedule('0 20 * * *', () => {
    maybeCatchUpParkReel('20:00 ET evening safety');
  }, { timezone: 'America/New_York' });

  // After deploy/restart: fill any overdue slot for the Eastern day (0→1 after 10:30, 1→2 after 7pm).
  setTimeout(() => {
    maybeCatchUpParkReel('startup');
  }, 90_000);

  console.log('Facebook park Reel scheduled: 10:30am tip + 7:00pm Disney news (Eastern) + startup/2pm/8pm catch-up if a slot was missed. Publishing gated by FB_PARK_REEL_PUBLISH=true.');
} else {
  console.log('Facebook park Reel NOT scheduled — set FB_PARK_REEL_ENABLED=true AND FB_PARK_REEL_PUBLISH=true in DigitalOcean (plus FB + Supabase credentials).');
}

// Drain queued park/cruise Facebook posts about every 90 minutes (Eastern).
// Article automate (4×/day) and guides (4×/day) also drain when they run;
// this grid is what makes “all of today’s park posts, spaced” actually finish
// the same day when volume is 6–10+. Spacing still enforced by FB_MIN_HOURS_BETWEEN_POSTS.
if (scheduleFlags.facebookFeedDrain) {
  for (const entry of FACEBOOK_FEED_DRAIN_CRONS) {
    cron.schedule(entry.cron, () => {
      console.log(`Running scheduled Facebook feed drain (${entry.label})...`);
      runScheduledCommand('facebook feed drain', 'node scripts/facebook-feed-drain.js');
    }, { timezone: 'America/New_York' });
  }
  console.log(
    'Facebook feed drain scheduled ~every 90 minutes Eastern '
    + '(7:30, 8:00, 9:30, 10:00, 12:30, 13:00, 14:30, 16:00, 17:30, 18:00, 20:30, 21:00, 22:30, 23:00) '
    + '— avoids automate hours; posts at most 1 park/cruise item per tick when spacing allows.'
  );
} else {
  console.log('Facebook feed drain NOT scheduled — set FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN, SUPABASE_URL, and SUPABASE_SERVICE_KEY.');
}
