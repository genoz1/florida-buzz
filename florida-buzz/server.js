require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/main'));

app.use((req, res) => res.status(404).render('404'));

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
