'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { merchConfig, parseProductsJson, loadCatalogFile } = require('../lib/merch');

test('catalog file drives two product cards; placeholders ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-merch-'));
  const file = path.join(dir, 'merch-products.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      storeUrl: 'https://florida-buzz.printify.me',
      products: [
        {
          title: 'Park Day Tee',
          url: 'https://florida-buzz.printify.me/product/1',
          imageUrl: 'https://images.example.com/1.jpg',
          description: 'Sizes on Printify',
        },
        {
          title: 'Sunset Tee',
          url: 'https://florida-buzz.printify.me/product/2',
          imageUrl: 'https://images.example.com/2.jpg',
        },
        {
          title: 'Replace with shirt name',
          url: 'https://YOUR-STORE.printify.me/product/x',
        },
      ],
    })
  );
  const cfg = merchConfig({}, { catalogPath: file });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.storeUrl, 'https://florida-buzz.printify.me/');
  assert.equal(cfg.products.length, 2);
  assert.equal(cfg.products[0].title, 'Park Day Tee');
  assert.equal(cfg.products[1].title, 'Sunset Tee');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('default catalog file loads without throwing', () => {
  const file = loadCatalogFile();
  assert.ok(file);
  assert.ok(Array.isArray(file.products));
});

test('SHOPIFY_STORE_URL / MERCH_STORE_URL override catalog storeUrl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-merch-'));
  const file = path.join(dir, 'merch-products.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      storeUrl: 'https://old.printify.me',
      products: [{ title: 'Tee', url: 'https://old.printify.me/product/1' }],
    })
  );
  const shopify = merchConfig(
    { SHOPIFY_STORE_URL: 'https://florida-buzz.myshopify.com' },
    { catalogPath: file }
  );
  assert.equal(shopify.storeUrl, 'https://florida-buzz.myshopify.com/');
  assert.equal(shopify.provider, 'shopify');
  assert.equal(shopify.checkoutLabel, 'Get yours');
  assert.equal(shopify.browseLabel, 'Browse all merch');

  const merchEnv = merchConfig(
    { MERCH_STORE_URL: 'https://shop.thefloridabuzz.com' },
    { catalogPath: file }
  );
  assert.equal(merchEnv.storeUrl, 'https://shop.thefloridabuzz.com/');

  const legacy = merchConfig(
    { PRINTIFY_STORE_URL: 'https://new.printify.me' },
    { catalogPath: file }
  );
  assert.equal(legacy.storeUrl, 'https://new.printify.me/');
  assert.equal(legacy.provider, 'printify');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MERCH_PRODUCTS / PRINTIFY_PRODUCTS JSON still works as override', () => {
  const products = parseProductsJson(
    JSON.stringify([{ title: 'Hat', url: 'https://store.myshopify.com/products/hat', price: '$22' }])
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'Hat');
});

test('merch page renders two products from catalog file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-merch-page-'));
  const catalogPath = path.join(dir, 'merch-products.json');
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({
      provider: 'shopify',
      storeUrl: 'https://florida-buzz.myshopify.com',
      products: [
        {
          title: 'I Caught My Buzz in Florida Tee',
          url: 'https://florida-buzz.myshopify.com/products/caught-my-buzz',
        },
        { title: 'Second Drop', url: 'https://florida-buzz.myshopify.com/products/two' },
      ],
    })
  );

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.get('/merch', (req, res) => {
    const merch = merchConfig({}, { catalogPath });
    res.render('merch', { merch, pageTitle: 'Buzz Merch — The Florida Buzz' });
  });

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
    assert.match(body, /I Caught My Buzz in Florida Tee/);
    assert.match(body, /Second Drop/);
    assert.match(body, /Get yours/);
    assert.match(body, /choose size and color/i);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
