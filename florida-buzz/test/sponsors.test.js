const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { sponsorsConfig, SPONSORS } = require('../lib/sponsors');

test('sponsorsConfig lists Rook Careers as the featured first sponsor', () => {
  const config = sponsorsConfig();
  assert.ok(config.featured.length >= 1);
  assert.equal(config.featured[0].id, 'rook-careers');
  assert.equal(config.featured[0].name, 'Rook Careers');
  assert.match(config.featured[0].url, /rookcareers\.com/);
  assert.equal(SPONSORS[0].id, 'rook-careers');
});

test('sponsors page renders Rook Careers and inquire CTA', async () => {
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
    assert.match(body, /Sponsors/);
    assert.match(body, /Rook Careers/);
    assert.match(body, /Featured sponsor/);
    assert.match(body, /Become a sponsor/);
    assert.match(body, /\/images\/sponsors\/rook-careers\.png/);
    assert.match(body, /rookcareers\.com/);
    assert.match(body, /floridabuzzonline@gmail\.com/);
  } finally {
    server.close();
  }
});
