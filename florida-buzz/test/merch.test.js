'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const path = require('node:path');
const { merchConfig, parseProductsJson } = require('../lib/merch');

test('merchConfig reads store URL and featured product env', () => {
  const cfg = merchConfig({
    PRINTIFY_STORE_URL: 'https://florida-buzz.printify.me/',
    PRINTIFY_FEATURED_TITLE: 'Park Day Tee',
    PRINTIFY_FEATURED_URL: 'https://florida-buzz.printify.me/product/1',
    PRINTIFY_FEATURED_IMAGE_URL: 'https://images.example.com/tee.jpg',
    PRINTIFY_FEATURED_PRICE: '$28',
    PRINTIFY_FEATURED_DESCRIPTION: 'Soft cotton for rope drop.',
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.storeUrl, 'https://florida-buzz.printify.me/');
  assert.equal(cfg.products.length, 1);
  assert.equal(cfg.products[0].title, 'Park Day Tee');
  assert.equal(cfg.products[0].price, '$28');
});

test('PRINTIFY_PRODUCTS JSON wins over featured shortcuts', () => {
  const products = parseProductsJson(
    JSON.stringify([
      { title: 'Hat', url: 'https://store.printify.me/hat', price: '$22' },
      { title: 'Skip', url: 'not-a-url' },
    ])
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'Hat');

  const cfg = merchConfig({
    PRINTIFY_PRODUCTS: JSON.stringify([
      { title: 'From JSON', url: 'https://store.printify.me/json' },
    ]),
    PRINTIFY_FEATURED_TITLE: 'Ignored',
    PRINTIFY_FEATURED_URL: 'https://store.printify.me/ignored',
  });
  assert.equal(cfg.products[0].title, 'From JSON');
});

test('merch page renders featured product and store CTA', async () => {
  process.env.PRINTIFY_STORE_URL = 'https://florida-buzz.printify.me';
  process.env.PRINTIFY_FEATURED_TITLE = 'Florida Buzz Tee';
  process.env.PRINTIFY_FEATURED_URL = 'https://florida-buzz.printify.me/product/shirt';
  process.env.PRINTIFY_FEATURED_PRICE = '$28';

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use('/', require('../routes/main'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    const body = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/merch`, (res) => {
          assert.equal(res.statusCode, 200);
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        })
        .on('error', reject);
    });
    assert.match(body, /Wear the Buzz/);
    assert.match(body, /Florida Buzz Tee/);
    assert.match(body, /florida-buzz\.printify\.me/);
    assert.match(body, /Buy on Printify/);
    assert.match(body, /href="\/merch"/);
  } finally {
    server.close();
    delete process.env.PRINTIFY_STORE_URL;
    delete process.env.PRINTIFY_FEATURED_TITLE;
    delete process.env.PRINTIFY_FEATURED_URL;
    delete process.env.PRINTIFY_FEATURED_PRICE;
  }
});
