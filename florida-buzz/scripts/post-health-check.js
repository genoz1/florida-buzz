require('dotenv').config();
const path = require('node:path');
const { spawn } = require('node:child_process');
const { supabase } = require('../lib/supabase');
const { sendEmail } = require('../lib/resend');
const { isUsableArticleImage } = require('../lib/articleImages');
const { createImageRepairQueue } = require('../lib/imageRepairQueue');
const {
  PLATFORMS,
  buildAlertEmail,
  buildHealthReport,
  findArticlesMissingImages,
  summarizePostLog,
} = require('../lib/opsHealthCheck');

const DRY_RUN = process.env.DRY_RUN === 'true';
const ISSUES_ONLY = process.env.OPS_HEALTH_MODE === 'issues_only'
  || process.argv.includes('--issues-only');
const LOOKBACK_HOURS = Math.max(1, Number(process.env.OPS_HEALTH_LOOKBACK_HOURS || 24));
const IMAGE_LOOKBACK_HOURS = Math.max(
  LOOKBACK_HOURS,
  Number(process.env.OPS_HEALTH_IMAGE_LOOKBACK_HOURS || 72)
);

// Uses Resend's shared test sender by default until thefloridabuzz.com is
// verified for alerts. Override with ALERT_FROM_EMAIL when ready.
const ALERT_FROM = process.env.ALERT_FROM_EMAIL || 'Florida Buzz Alerts <onboarding@resend.dev>';

async function loadRecentPostLog(hours = LOOKBACK_HOURS) {
  if (!supabase) return [];
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('post_log')
    .select('platform, status, detail, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error(`  [error] Could not fetch post_log: ${error.message}`);
    return [];
  }
  return data || [];
}

async function loadRecentArticles(hours = IMAGE_LOOKBACK_HOURS) {
  if (!supabase) return [];
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, dek, category, city, published_at, image_url, source_url')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error(`  [error] Could not fetch articles: ${error.message}`);
    return [];
  }
  return data || [];
}

function startSameDayImageRepair(slug, {
  spawnImpl = spawn,
  execPath = process.execPath,
  scriptPath = path.join(__dirname, 'repair-article-images.js'),
  env = process.env,
  logger = console,
} = {}) {
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
  if (env.SKIP_SAME_DAY_IMAGE_REPAIR === 'true') return false;
  if (env.OPS_HEALTH_AUTO_FIX === 'false') return false;
  try {
    const child = spawnImpl(
      execPath,
      [scriptPath, slug],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...env,
          APPLY_IMAGE_REPAIR: 'true',
          PRODUCTION_IMAGE_REPAIR_APPROVED: 'true',
          VERIFY_IMAGE_BYTES: 'false',
          IMAGE_REPAIR_GENERATION_LIMIT: env.SAME_DAY_IMAGE_REPAIR_LIMIT || '2',
          IMAGE_REPAIR_SLUGS: slug,
        },
      }
    );
    child.unref?.();
    logger.log(`  Auto-fix: started image repair for /article/${slug}.`);
    return true;
  } catch (error) {
    logger.error(`  [warning] Auto image repair spawn failed (${error.message}).`);
    return false;
  }
}

async function applyAutoRemediations(report, articlesBySlug = new Map()) {
  const remediations = [];
  if (process.env.OPS_HEALTH_AUTO_FIX === 'false') {
    return remediations;
  }

  const missingImageIssue = (report.issues || []).find((i) => i.code === 'articles_missing_images');
  if (missingImageIssue && supabase) {
    const queue = createImageRepairQueue(supabase);
    let queued = 0;
    let kicked = 0;
    const targets = (report.missingImages || []).slice(0, 8);
    for (const row of targets) {
      const article = articlesBySlug.get(row.slug) || row;
      if (!article?.id) continue;
      const ok = await queue.enqueue(article, {
        reason: 'ops_health_missing_image',
        immediate: true,
      });
      if (ok) queued += 1;
    }
    for (const row of targets.slice(0, 3)) {
      if (startSameDayImageRepair(row.slug)) kicked += 1;
    }
    remediations.push({
      code: 'articles_missing_images',
      ok: queued > 0 || kicked > 0,
      detail: `Queued image repair for ${queued}/${targets.length} stor${targets.length === 1 ? 'y' : 'ies'}; kicked ${kicked} same-day repair job(s).`,
    });
  }

  if ((report.issues || []).some((i) => i.code === 'facebook_quiet') && supabase) {
    // Best-effort nudge: spawn the feed drain so deferred FB posts can clear.
    try {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, 'facebook-feed-drain.js')],
        { detached: true, stdio: 'ignore', env: { ...process.env } }
      );
      child.unref?.();
      remediations.push({
        code: 'facebook_quiet',
        ok: true,
        detail: 'Spawned facebook-feed-drain.js to clear any spaced/deferred Facebook queue items.',
      });
    } catch (error) {
      remediations.push({
        code: 'facebook_quiet',
        ok: false,
        detail: `Could not spawn Facebook feed drain: ${error.message}`,
      });
    }
  }

  return remediations;
}

async function buildReport() {
  const [posts, articles] = await Promise.all([
    loadRecentPostLog(LOOKBACK_HOURS),
    loadRecentArticles(IMAGE_LOOKBACK_HOURS),
  ]);
  const platformSummary = summarizePostLog(posts);
  const missingImages = findArticlesMissingImages(articles, { isUsableArticleImage });
  const report = buildHealthReport({
    platformSummary,
    missingImages,
    lookbackHours: LOOKBACK_HOURS,
  });
  return { report, articles };
}

async function run() {
  console.log(`=== Publishing self-check — ${new Date().toISOString()} ===`);
  console.log(`Mode: ${ISSUES_ONLY ? 'issues_only' : 'digest'} · lookback ${LOOKBACK_HOURS}h · image lookback ${IMAGE_LOOKBACK_HOURS}h`);

  if (!process.env.ALERT_EMAIL_TO) {
    console.error('[error] ALERT_EMAIL_TO not set — cannot send health check email.');
    process.exit(1);
  }

  const { report, articles } = await buildReport();
  const articlesBySlug = new Map((articles || []).map((a) => [a.slug, a]));
  const remediations = report.ok ? [] : await applyAutoRemediations(report, articlesBySlug);
  if (remediations.length) {
    console.log('Auto-remediation:');
    remediations.forEach((r) => console.log(`  ${r.ok ? 'ok' : 'warn'} ${r.detail}`));
  }

  const { subject, html, allGood } = buildAlertEmail(report, {
    siteUrl: (process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, ''),
    adminPassword: process.env.ADMIN_PASSWORD || '',
    remediations,
  });

  console.log(`Subject: ${subject}`);
  console.log(`Issues: ${report.issues.length} (critical=${report.criticalCount})`);
  PLATFORMS.forEach((p) => {
    const s = report.platforms[p];
    console.log(`  ${p}: ${s.success} ok, ${s.failed} failed, ${s.missingLink || 0} missing-link`);
  });
  if (report.missingImages.length) {
    console.log(`  missing images: ${report.missingImages.map((a) => a.slug).join(', ')}`);
  }

  if (ISSUES_ONLY && allGood) {
    console.log('No issues — skipping email (issues_only mode).');
    console.log('\n=== Run complete ===');
    return { report, emailed: false };
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] Would send email to:', process.env.ALERT_EMAIL_TO);
    return { report, emailed: false };
  }

  if (!process.env.RESEND_API_KEY) {
    console.log('  [skip] RESEND_API_KEY not set — skipping email send.');
    return { report, emailed: false };
  }

  try {
    await sendEmail({
      to: process.env.ALERT_EMAIL_TO,
      subject,
      html,
      from: ALERT_FROM,
    });
    console.log('  Email sent successfully.');
  } catch (err) {
    console.error(`  [error] Could not send health check email: ${err.message}`);
    process.exitCode = 1;
    return { report, emailed: false };
  }

  console.log('\n=== Run complete ===');
  return { report, emailed: true };
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal error in post-health-check run:', err);
    process.exit(1);
  });
}

module.exports = { run, buildReport };
