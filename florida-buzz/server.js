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
  });
  console.log('Automation scheduled: 6am, 11am, 3pm, 7pm daily.');
} else {
  console.log('Automation NOT scheduled — set ANTHROPIC_API_KEY to enable.');
}

// Generates one new evergreen guide per day (web-search-grounded research, then
// writes, images, and posts it), so the weekly newsletter and /guides page keep
// getting fresh reference content alongside the news items. Runs before the first
// news automation pass. Disabled until ANTHROPIC_API_KEY and OPENAI_API_KEY are set.
if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) {
  cron.schedule('30 5 * * *', () => {
    console.log('Running scheduled evergreen guide generation...');
    require('child_process').exec('node scripts/generate-guide.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  });
  console.log('Evergreen guide generation scheduled: 5:30am daily.');
} else {
  console.log('Evergreen guide generation NOT scheduled — set ANTHROPIC_API_KEY and OPENAI_API_KEY to enable.');
}

// Sends the weekly digest every Monday at 8am. Disabled until RESEND_API_KEY is set.
if (process.env.RESEND_API_KEY) {
  cron.schedule('0 8 * * 1', () => {
    console.log('Running scheduled newsletter send...');
    require('child_process').exec('node scripts/newsletter.js', (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  });
  console.log('Newsletter scheduled: Mondays at 8am.');
} else {
  console.log('Newsletter NOT scheduled — set RESEND_API_KEY to enable.');
}
