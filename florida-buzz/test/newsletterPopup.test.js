'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('newsletter popup partial posts to /subscribe with honeypot and source', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../views/partials/newsletter-popup.ejs'),
    'utf8'
  );
  assert.match(html, /action="\/subscribe"/);
  assert.match(html, /name="website"/);
  assert.match(html, /name="form_rendered_at"/);
  assert.match(html, /name="return_to"/);
  assert.match(html, /source" value="popup"/);
  assert.match(html, /news|guides|travel discounts|planning/i);
});

test('footer includes newsletter popup and updated benefits copy', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '../views/partials/footer.ejs'),
    'utf8'
  );
  assert.match(html, /newsletter-popup/);
  assert.match(html, /planning guides|travel discounts/i);
});

test('newsletter popup script snoozes and respects subscribe cookie', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '../public/js/newsletter-popup.js'),
    'utf8'
  );
  assert.match(js, /fb_nl_popup_v1/);
  assert.match(js, /fb_newsletter/);
  assert.match(js, /DELAY_MS/);
  assert.match(js, /mouseout/);
  assert.match(js, /14000/);
});

test('server exposes request path as canonicalPath for subscribe return_to', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /res\.locals\.canonicalPath\s*=\s*req\.path/);
});
