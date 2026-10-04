require('dotenv').config();

const crypto = require('node:crypto');
const { imageSize } = require('image-size');
const Parser = require('rss-parser');
const knownInventory = require('../content/ARTICLE_IMAGE_REPAIR_INVENTORY.json');
const { ARTICLE_PLACEHOLDER_PATH, findDuplicateImage, imageIdentity, isLikelyGenericSourceImage } = require('../lib/articleImages');
const { createImageRepairQueue } = require('../lib/imageRepairQueue');
const { runImageRepairBatch } = require('../lib/imageRepairWorkflow');
const { extractImage, originCropPercent } = require('./automate');
const SOURCES = require('./sources');
const { storeImageFromUrl, supabase, thumbUrl } = require('../lib/supabase');

const APPLY = process.env.APPLY_IMAGE_REPAIR === 'true';
const APPROVED = process.env.PRODUCTION_IMAGE_REPAIR_APPROVED === 'true';
const VERIFY_BYTES = process.env.VERIFY_IMAGE_BYTES !== 'false';
const DAYS = Math.max(1, Math.min(Number(process.env.IMAGE_AUDIT_DAYS || 14), 60));
const requested = new Set(process.argv.slice(2).filter((value) => !value.startsWith('--')));
const knownBySlug = new Map(knownInventory.map((item) => [item.slug, item]));
const parser = new Parser({ timeout: 15000, customFields: { item: [['media:content', 'mediaContent', { keepArray: true }], ['media:thumbnail', 'mediaThumbnail']] } });

function easternCalendarStart(days = DAYS, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number);
  const utcMidnight = Date.UTC(parts[0], parts[1] - 1, parts[2] - (days - 1), 4, 0, 0);
  return new Date(utcMidnight).toISOString();
}

function obviousImageIssue(article) {
  const url = String(article.image_url || '').trim();
  if (!url) return 'missing_image';
  const identity = imageIdentity(url);
  if (identity === ARTICLE_PLACEHOLDER_PATH || /article-placeholder|picsum\.photos|placehold(?:er)?\./i.test(url)) {
    return 'placeholder_or_generic_fallback';
  }
  if (isLikelyGenericSourceImage(url)) return 'generic_source_asset';
  return null;
}

async function inspectStoredImage(article, fetchImpl = fetch) {
  const issue = obviousImageIssue(article);
  if (issue || !VERIFY_BYTES) return { issue, fingerprint: null, dimensions: null };
  try {
    const response = await fetchImpl(thumbUrl(article.image_url), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { issue: `image_http_${response.status}`, fingerprint: null, dimensions: null };
    const buffer = Buffer.from(await response.arrayBuffer());
    const dimensions = imageSize(buffer);
    if (!dimensions.width || !dimensions.height || dimensions.width < 400 || dimensions.height < 300) {
      return { issue: 'image_too_small_or_unreadable', fingerprint: null, dimensions };
    }
    return {
      issue: null,
      fingerprint: crypto.createHash('sha256').update(buffer).digest('hex'),
      dimensions: { width: dimensions.width, height: dimensions.height },
    };
  } catch (error) {
    return { issue: `image_fetch_failed:${String(error.message).slice(0, 120)}`, fingerprint: null, dimensions: null };
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, next));
  return output;
}

function flagDuplicateImages(inspected) {
  const byFingerprint = new Map();
  for (const row of inspected) {
    if (!row.fingerprint) continue;
    if (byFingerprint.has(row.fingerprint)) byFingerprint.get(row.fingerprint).push(row);
    else byFingerprint.set(row.fingerprint, [row]);
  }
  for (const rows of byFingerprint.values()) {
    if (rows.length < 2) continue;
    const ordered = [...rows].sort((left, right) => (
      String(left.article.published_at || '').localeCompare(String(right.article.published_at || ''))
    ));
    for (const row of ordered.slice(1)) row.issue = 'duplicate_recent_image';
  }
  return inspected;
}

async function auditRecentArticles(client = supabase, { now = new Date(), fetchImpl = fetch } = {}) {
  if (!client) throw new Error('Supabase is not configured.');
  const since = easternCalendarStart(DAYS, now);
  const { data, error } = await client.from('articles')
    .select('id, slug, title, dek, body_html, category, city, source_url, image_url, published_at')
    .gte('published_at', since)
    .order('published_at', { ascending: false });
  if (error) throw new Error(`Could not inventory recent articles: ${error.message}`);
  const articles = requested.size ? (data || []).filter((article) => requested.has(article.slug)) : (data || []);
  const inspected = await mapLimit(articles, 8, async (article) => ({
    article,
    ...(await inspectStoredImage(article, fetchImpl)),
  }));

  flagDuplicateImages(inspected);

  return {
    since,
    articles,
    inspected,
    good: inspected.filter((row) => !row.issue),
    needsRepair: inspected.filter((row) => row.issue),
  };
}

async function seedRepairs(client, audit) {
  const queue = createImageRepairQueue(client);
  let queued = 0;
  const knownPriority = new Map(knownInventory.map((item, index) => [item.slug, index]));
  const ordered = [...audit.needsRepair].sort((left, right) => {
    const leftPriority = knownPriority.get(left.article.slug) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = knownPriority.get(right.article.slug) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority;
  });
  for (const row of ordered) {
    const known = knownBySlug.get(row.article.slug) || {};
    const ok = await queue.enqueue(row.article, {
      reason: row.issue,
      context: {
        location: known.location || row.article.city || '',
        imageSubject: known.imageSubject || row.article.title,
        imageEntities: known.imageEntities || [],
      },
    });
    if (ok) queued += 1;
  }
  return queued;
}

async function recoverRssImages(client, audit) {
  const missingBySource = new Map(audit.needsRepair
    .filter((row) => row.issue === 'missing_image' && /^https?:/i.test(row.article.source_url || '')
      && !/thefloridabuzz\.com/i.test(row.article.source_url || ''))
    .map((row) => [row.article.source_url, row]));
  if (!missingBySource.size) return [];

  const matches = new Map();
  await mapLimit(SOURCES, 6, async (source) => {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items || []) {
        if (!missingBySource.has(item.link)) continue;
        const imageUrl = extractImage(item);
        if (imageUrl && !isLikelyGenericSourceImage(imageUrl)) matches.set(item.link, imageUrl);
      }
    } catch (error) {
      console.warn(`[source-recovery] ${source.name}: ${error.message}`);
    }
  });

  const recovered = [];
  for (const [sourceUrl, imageUrl] of matches) {
    const row = missingBySource.get(sourceUrl);
    const storedUrl = await storeImageFromUrl(imageUrl, `${row.article.slug}.jpg`, {
      cropBottomPercent: originCropPercent(sourceUrl),
      contentAddressed: true,
    });
    if (!storedUrl) continue;
    const { data: existing, error: duplicateError } = await client.from('articles')
      .select('slug,title,image_url').eq('image_url', storedUrl).limit(25);
    if (duplicateError || findDuplicateImage(storedUrl, existing || [], row.article.slug)) continue;
    const { data, error } = await client.from('articles').update({ image_url: storedUrl })
      .eq('id', row.article.id).is('image_url', null).select('slug,image_url').maybeSingle();
    if (!error && data) {
      recovered.push(data.slug);
      console.log(`[source-recovered] ${data.slug}`);
    }
  }
  return recovered;
}

async function reportQueue(client) {
  const { data, error } = await client.from('article_image_repairs')
    .select('article_slug,status,reason,generation_attempts,review_attempts,last_error,next_attempt_at')
    .neq('status', 'accepted')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not report image repair queue: ${error.message}`);
  return data || [];
}

async function run() {
  if (!supabase) throw new Error('Supabase is not configured.');
  let audit = await auditRecentArticles(supabase);
  console.log(JSON.stringify({
    audit_days: DAYS,
    since: audit.since,
    inspected: audit.inspected.length,
    good: audit.good.length,
    needs_repair: audit.needsRepair.length,
    verify_bytes: VERIFY_BYTES,
  }));
  for (const row of audit.needsRepair) console.log(`[needs-image] ${row.article.slug}: ${row.issue}`);

  if (!APPLY) {
    console.log('Dry run only. No database, storage, generation, or social action occurred.');
    return { audit, queued: 0, results: [], remaining: [] };
  }
  if (!APPROVED) throw new Error('Applying repairs requires PRODUCTION_IMAGE_REPAIR_APPROVED=true.');

  let recovered = [];
  if (process.env.RECOVER_RSS_IMAGES === 'true') {
    recovered = await recoverRssImages(supabase, audit);
    if (recovered.length) audit = await auditRecentArticles(supabase);
  }
  const queued = await seedRepairs(supabase, audit);
  console.log(`Queued or refreshed ${queued} durable image repair item(s).`);
  const results = await runImageRepairBatch(supabase, { slugs: [...requested], recoverLegacy: process.env.RECOVER_LEGACY_IMAGE_REPAIRS === 'true' });
  const remaining = await reportQueue(supabase);
  console.log(JSON.stringify({ repaired_this_run: results.filter((row) => row.status === 'accepted').length, remaining: remaining.length }));
  for (const row of remaining) console.log(`[remaining] ${row.article_slug}: ${row.status} — ${row.last_error || row.reason}`);
  return { audit, recovered, queued, results, remaining };
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  auditRecentArticles,
  easternCalendarStart,
  flagDuplicateImages,
  inspectStoredImage,
  obviousImageIssue,
  recoverRssImages,
  run,
  seedRepairs,
};
