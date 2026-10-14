#!/usr/bin/env node
'use strict';

/**
 * Read-only duplicate-content report for Florida Buzz articles.
 * Does NOT delete or redirect anything — report only.
 *
 * Usage:
 *   node scripts/duplicate-content-report.js
 *   node scripts/duplicate-content-report.js --out /tmp/fb-duplicate-report.json
 */

require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { isRedirectedArticleSlug } = require('../lib/articleRedirects');

function tokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function numberedSuffix(slug) {
  const m = String(slug || '').match(/^(.*)-(\d{1,3})$/);
  if (!m) return null;
  return { base: m[1], n: Number(m[2]) };
}

async function fetchAll(client) {
  const rows = [];
  const batch = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('articles')
      .select('slug,title,dek,category,published_at,source_name,is_evergreen')
      .order('published_at', { ascending: false })
      .range(from, from + batch - 1);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < batch) break;
    from += batch;
  }
  return rows;
}

async function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const url = process.env.SUPABASE_URL || process.env.FLORIDA_BUZZ_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Supabase credentials required (SUPABASE_URL + SUPABASE_SERVICE_KEY).');
    process.exit(1);
  }
  const client = createClient(url, key);
  const articles = await fetchAll(client);

  const numberedGroups = new Map();
  const machineSuffix = [];
  const nearPairs = [];

  for (const a of articles) {
    const suf = numberedSuffix(a.slug);
    if (suf) {
      if (!numberedGroups.has(suf.base)) numberedGroups.set(suf.base, []);
      numberedGroups.get(suf.base).push(a);
    }
    if (/(?:-[a-f0-9]{6,}|-\d{10,}|sample-|insufficient-source)/i.test(a.slug)) {
      machineSuffix.push(a);
    }
  }

  const withTokens = articles.map((a) => ({
    ...a,
    t: tokens(`${a.title} ${a.dek || ''}`),
  }));

  for (let i = 0; i < withTokens.length; i += 1) {
    for (let j = i + 1; j < Math.min(withTokens.length, i + 80); j += 1) {
      const left = withTokens[i];
      const right = withTokens[j];
      if (left.category !== right.category) continue;
      const score = jaccard(left.t, right.t);
      if (score >= 0.55) {
        nearPairs.push({
          score: Number(score.toFixed(3)),
          a: { slug: left.slug, title: left.title },
          b: { slug: right.slug, title: right.title },
          redirectedLoser: isRedirectedArticleSlug(left.slug) || isRedirectedArticleSlug(right.slug),
        });
      }
    }
  }

  nearPairs.sort((x, y) => y.score - x.score);

  const report = {
    generated_at: new Date().toISOString(),
    article_count: articles.length,
    numbered_suffix_groups: [...numberedGroups.entries()]
      .filter(([, rows]) => rows.length >= 1)
      .map(([base, rows]) => ({
        base,
        count: rows.length,
        slugs: rows.map((r) => r.slug),
        titles: rows.map((r) => r.title),
      })),
    machine_or_placeholder_slugs: machineSuffix.map((r) => ({
      slug: r.slug,
      title: r.title,
    })),
    near_identical_pairs: nearPairs.slice(0, 200),
    note: 'Report only — no deletions or redirects were applied.',
  };

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(json);
  }
  console.error(
    `Duplicate report: ${report.numbered_suffix_groups.length} numbered groups, ${report.machine_or_placeholder_slugs.length} machine/placeholder slugs, ${report.near_identical_pairs.length} near pairs (capped).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
