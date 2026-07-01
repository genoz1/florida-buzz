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
