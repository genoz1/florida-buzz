require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { logNotFound } = require('./lib/notFoundLog');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// IndexNow key verification file — must be served at the site root with a
// filename matching the key itself, containing just the key as plain text.
// This is how Bing/IndexNow confirms you actually control this domain.
if (process.env.INDEXNOW_KEY) {
  app.get(`/${process.env.INDEXNOW_KEY}.txt`, (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(process.env.INDEXNOW_KEY);
  });
}

app.use('/', require('./routes/main'));

app.use((req, res) => {
  logNotFound(req.originalUrl, req.get('referer'));
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`The Florida Buzz running on port ${PORT}`);
});

// Runs the RSS -> AI -> publish -> post pipeline automatically, 4x/day.
// Adjust the cron schedule once you've confirmed costs/volume feel right.
// Disabled by default until ANTHROPIC_API_KEY is set, so it doesn't error on a fresh deploy.
if (process.env.ANTHROPIC_API_KEY) {
  cron.schedule('0 6,11,15,19 * * *', () => {
    console.log('Running scheduled automation...');
    require('child_process').exec('node scripts/automate.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });
  console.log('Automation scheduled: 6am, 11am, 3pm, 7pm daily (Eastern time).');
} else {
  console.log('Automation NOT scheduled — set ANTHROPIC_API_KEY to enable.');
}

// Generates new evergreen guides (web-search-grounded research, then writes,
// images, and posts them), 2x/day, so the daily newsletter and /guides page
// keep getting fresh reference content alongside the news items. Spaced away
// from the article automation and promo post times above. Disabled until
// ANTHROPIC_API_KEY and OPENAI_API_KEY are set.
if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) {
  cron.schedule('45 7,18 * * *', () => {
    console.log('Running scheduled evergreen guide generation...');
    require('child_process').exec('node scripts/generate-guide.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });
  console.log('Evergreen guide generation scheduled: 7:45am and 6:45pm daily (Eastern time).');
} else {
  console.log('Evergreen guide generation NOT scheduled — set ANTHROPIC_API_KEY and OPENAI_API_KEY to enable.');
}

// Sends the daily digest every day at 8am. Disabled until RESEND_API_KEY is set.
// NOTE: daily sending is currently blocked upstream by the Wix-to-Cloudflare
// domain transfer needed for MX records / Resend domain verification — this
// schedule is set correctly now so it's already right once that unblocks.
if (process.env.RESEND_API_KEY) {
  cron.schedule('0 8 * * *', () => {
    console.log('Running scheduled newsletter send...');
    require('child_process').exec('node scripts/newsletter.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });
  console.log('Newsletter scheduled: daily at 8am (Eastern time).');
} else {
  console.log('Newsletter NOT scheduled — set RESEND_API_KEY to enable.');
}

// Posts a promotional (non-article) message to the Facebook Page twice a day,
// rotating between: general brand awareness, newsletter signup, and a random
// evergreen guide highlight. Spaced away from the article posting times above.
// Disabled until FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN are set.
if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
  cron.schedule('0 9,20 * * *', () => {
    console.log('Running scheduled promo post...');
    require('child_process').exec('node scripts/promo-post.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
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
if (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
  cron.schedule('0 10 * * 1,5', () => {
    console.log('Running scheduled city roundup...');
    require('child_process').exec('node scripts/city-roundup.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });
  console.log('City roundups scheduled: Mondays and Fridays at 10am (Eastern time).');
} else {
  console.log('City roundups NOT scheduled — set FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN to enable.');
}

// Posts one lightweight "vote in the comments" engagement post per day to
// Facebook — separate from news, guides, and promo content. Starting at
// ONE per day deliberately (not the 10/day some tools suggest) since the
// Page is still small; scale this up later only if it's clearly working.
// Spaced away from every other scheduled post above. Disabled until
// ANTHROPIC_API_KEY, FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN are set.
if (process.env.ANTHROPIC_API_KEY && process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
  cron.schedule('30 13 * * *', () => {
    console.log('Running scheduled engagement post...');
    require('child_process').exec('node scripts/engagement-post.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });
  console.log('Engagement post scheduled: 1:30pm daily (Eastern time).');
} else {
  console.log('Engagement post NOT scheduled — set ANTHROPIC_API_KEY, FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN to enable.');
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
if (process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO) {
  cron.schedule('15 8 * * *', () => {
    console.log('Running scheduled post health check...');
    require('child_process').exec('node scripts/post-health-check.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
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
// routes/main.js. Disabled until ANTHROPIC_API_KEY is set.
const DINING_DIRECTORY_PARKS = ['magic-kingdom', 'epcot', 'hollywood-studios', 'animal-kingdom', 'resorts'];

if (process.env.ANTHROPIC_API_KEY) {
  cron.schedule('0 5 1 * *', () => {
    DINING_DIRECTORY_PARKS.forEach((park) => {
      console.log(`Running scheduled dining directory refresh for ${park}...`);
      require('child_process').exec(
        `PARK=${park} node scripts/generate-dining-directory.js`,
        (err, stdout, stderr) => {
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
        }
      );
    });
  }, { timezone: 'America/New_York' });
  console.log(`Dining directory refresh scheduled: 1st of each month at 5am (Eastern time), covering: ${DINING_DIRECTORY_PARKS.join(', ')}.`);
} else {
  console.log('Dining directory refresh NOT scheduled — set ANTHROPIC_API_KEY to enable.');
}

// Promotes the site's own tools (wait times, dining directories) rather than
// a specific article — one post per topic per day, each to all 4 platforms,
// with a fresh AI-written caption every time but a reused cached image (see
// scripts/promo-feature-post.js). Spaced well away from every other
// scheduled post above. Disabled until ANTHROPIC_API_KEY, OPENAI_API_KEY,
// FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN are all set.
if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY && process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN) {
  cron.schedule('30 12 * * *', () => {
    console.log('Running scheduled wait-times promo post...');
    require('child_process').exec('TOPIC=wait-times node scripts/promo-feature-post.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });

  cron.schedule('30 16 * * *', () => {
    console.log('Running scheduled dining promo post...');
    require('child_process').exec('TOPIC=dining node scripts/promo-feature-post.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  }, { timezone: 'America/New_York' });

  console.log('Feature promo posts scheduled: wait-times at 12:30pm, dining at 4:30pm daily (Eastern time).');
} else {
  console.log('Feature promo posts NOT scheduled — set ANTHROPIC_API_KEY, OPENAI_API_KEY, FB_PAGE_ID, and FB_PAGE_ACCESS_TOKEN to enable.');
}
