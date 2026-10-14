const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const {
  sponsorsConfig,
  SPONSORS,
  becomeSponsorPageData,
  SPONSOR_TIERS,
  stripeConfigured,
} = require('../lib/sponsors');
const { validateApplication } = require('../lib/sponsorApplications');

test('sponsorsConfig lists Rook Careers as the featured first sponsor', () => {
  const config = sponsorsConfig();
  assert.ok(config.featured.length >= 1);
  assert.equal(config.featured[0].id, 'rook-careers');
  assert.equal(config.featured[0].name, 'Rook Careers');
  assert.match(config.featured[0].url, /rookcareers\.com/);
  assert.equal(SPONSORS[0].id, 'rook-careers');
  assert.equal(config.becomePath, '/sponsors/become');
});

test('sponsor tiers match founding annual packages', () => {
  assert.equal(SPONSOR_TIERS.length, 3);
  assert.equal(SPONSOR_TIERS[0].id, 'supporting');
  assert.equal(SPONSOR_TIERS[0].annualCents, 58800);
  assert.equal(SPONSOR_TIERS[1].id, 'featured');
  assert.equal(SPONSOR_TIERS[1].annualCents, 118800);
  assert.equal(SPONSOR_TIERS[2].id, 'premier');
  assert.equal(SPONSOR_TIERS[2].annualCents, 238800);
  const page = becomeSponsorPageData({});
  assert.equal(page.stripeReady, false);
  assert.equal(page.tiers[1].annualLabel, '$1,188');
});

test('stripeConfigured requires secret and all three price IDs', () => {
  assert.equal(stripeConfigured({}), false);
  assert.equal(
    stripeConfigured({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_PRICE_SPONSOR_SUPPORTING: 'price_s',
      STRIPE_PRICE_SPONSOR_FEATURED: 'price_f',
      STRIPE_PRICE_SPONSOR_PREMIER: 'price_p',
    }),
    true
  );
});

test('validateApplication requires logo, description, and tier', () => {
  const { errors } = validateApplication(
    {
      company_name: 'Acme',
      contact_name: 'Pat',
      email: 'pat@example.com',
      website_url: 'https://example.com',
      description: 'Short',
      tier_id: 'featured',
    },
    null
  );
  assert.ok(errors.some((e) => /description/i.test(e)));
  assert.ok(errors.some((e) => /logo/i.test(e)));
});

test('sponsors page links to become-a-sponsor flow', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.get('/sponsors', (req, res) => {
    res.render('sponsors', {
      sponsors: sponsorsConfig(),
      pageTitle: 'Sponsors — The Florida Buzz',
    });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/sponsors`, (res) => {
          assert.equal(res.statusCode, 200);
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
        .on('error', reject);
    });
    assert.match(body, /Rook Careers/);
    assert.match(body, /Become a sponsor/);
    assert.match(body, /href="\/sponsors\/become"/);
    assert.match(body, /href="\/sponsors\/packet"/);
    assert.doesNotMatch(body, /Email about sponsorship/);
  } finally {
    server.close();
  }
});

test('become-sponsor page renders packet, tiers, form, and payment area', async () => {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.get('/sponsors/become', (req, res) => {
    const page = becomeSponsorPageData({});
    res.render('become-sponsor', {
      ...page,
      formValues: {},
      flash: { errors: [], canceled: false, stripePending: false, companyName: '' },
      pageTitle: 'Become a Sponsor — The Florida Buzz',
    });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/sponsors/become`, (res) => {
          assert.equal(res.statusCode, 200);
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
        .on('error', reject);
    });
    assert.match(body, /Sponsor packet/);
    assert.match(body, /Supporting Sponsor/);
    assert.match(body, /Featured Sponsor/);
    assert.match(body, /Premier Sponsor/);
    assert.match(body, /\$588/);
    assert.match(body, /\$1,188/);
    assert.match(body, /\$2,388/);
    assert.match(body, /name="logo"/);
    assert.match(body, /name="description"/);
    assert.match(body, /Payment/);
    assert.match(body, /Stripe checkout is being set up/);
  } finally {
    server.close();
  }
});
