'use strict';

/**
 * Production self-check for Florida Buzz publishing.
 * Catches the failures that used to sit unnoticed for days:
 * - social platforms with zero successes or fresh API failures
 * - published stories with no usable hero photo
 * - social successes that logged [link:MISSING]
 */

const PLATFORMS = ['facebook', 'instagram', 'pinterest', 'threads'];
const SITE_HOST_RE = /thefloridabuzz\.com/i;
const LINK_MARKER_RE = /\[link:(MISSING|[^\]]+)\]/i;

function emptyPlatformSummary() {
  const summary = {};
  for (const p of PLATFORMS) {
    summary[p] = { success: 0, failed: 0, failures: [], missingLink: 0, missingLinkSamples: [] };
  }
  return summary;
}

function parseLinkMarker(detail) {
  const match = String(detail || '').match(LINK_MARKER_RE);
  if (!match) return { present: false, missing: false, value: null };
  if (match[1] === 'MISSING') return { present: true, missing: true, value: null };
  return { present: true, missing: false, value: match[1] };
}

function summarizePostLog(rows = []) {
  const summary = emptyPlatformSummary();
  for (const row of rows) {
    const platform = row?.platform;
    if (!summary[platform]) continue;
    if (row.status === 'success') {
      summary[platform].success += 1;
      const link = parseLinkMarker(row.detail);
      if (link.missing) {
        summary[platform].missingLink += 1;
        if (summary[platform].missingLinkSamples.length < 5) {
          summary[platform].missingLinkSamples.push(row.detail || '(no detail)');
        }
      } else if (!link.present && platform !== 'pinterest') {
        // Legacy rows (pre-marker) or captions that never got a URL logged.
        // Soft-detect: success detail with no site host and no explicit marker.
        const detail = String(row.detail || '');
        if (detail && !SITE_HOST_RE.test(detail) && !/cooldown_skip|dry_run|park-reel:|buzzboard:/i.test(detail)) {
          // Don't auto-count legacy rows as failures — only marker-based MISSING.
        }
      }
    } else {
      summary[platform].failed += 1;
      if (summary[platform].failures.length < 8) {
        summary[platform].failures.push(row.detail || '(no detail)');
      }
    }
  }
  return summary;
}

function isBlankImage(url) {
  return typeof url !== 'string' || !url.trim();
}

/**
 * @param {Array<{slug:string,title?:string,published_at?:string,image_url?:string|null}>} articles
 * @param {{ isUsableArticleImage?: (url:string)=>boolean }} [opts]
 */
function findArticlesMissingImages(articles = [], { isUsableArticleImage } = {}) {
  const usable = typeof isUsableArticleImage === 'function'
    ? isUsableArticleImage
    : (url) => !isBlankImage(url);
  return (articles || [])
    .filter((row) => !usable(row?.image_url))
    .map((row) => ({
      slug: row.slug,
      title: row.title || row.slug,
      published_at: row.published_at || null,
      image_url: row.image_url || null,
    }));
}

function collectIssues(platformSummary, missingImages = []) {
  const issues = [];
  for (const platform of PLATFORMS) {
    const row = platformSummary[platform] || { success: 0, failed: 0, missingLink: 0 };
    if (row.success === 0) {
      issues.push({
        severity: 'critical',
        code: `${platform}_quiet`,
        message: `${platform}: no successful posts in the lookback window`,
      });
    }
    if (row.failed > 0) {
      issues.push({
        severity: row.success === 0 ? 'critical' : 'warning',
        code: `${platform}_failures`,
        message: `${platform}: ${row.failed} failed post(s)`,
      });
    }
    if (row.missingLink > 0) {
      issues.push({
        severity: 'critical',
        code: `${platform}_missing_link`,
        message: `${platform}: ${row.missingLink} successful post(s) logged without a site/story URL`,
      });
    }
  }
  if (missingImages.length) {
    issues.push({
      severity: 'critical',
      code: 'articles_missing_images',
      message: `${missingImages.length} published stor${missingImages.length === 1 ? 'y' : 'ies'} missing a usable photo`,
    });
  }
  return issues;
}

function buildHealthReport({
  platformSummary,
  missingImages = [],
  lookbackHours = 24,
  generatedAt = new Date(),
} = {}) {
  const issues = collectIssues(platformSummary || emptyPlatformSummary(), missingImages);
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  return {
    generatedAt: generatedAt.toISOString(),
    lookbackHours,
    platforms: platformSummary || emptyPlatformSummary(),
    missingImages,
    issues,
    criticalCount,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    ok: issues.length === 0,
  };
}

/**
 * Human + auto remediation for each issue code.
 * `auto` describes what the self-check will attempt without waiting for a reply.
 */
function buildRemediationSteps(report, {
  siteUrl = 'https://thefloridabuzz.com',
  adminPassword = '',
  remediations = [],
} = {}) {
  const adminKey = adminPassword || 'ADMIN_PASSWORD';
  const steps = [];
  const codes = new Set((report.issues || []).map((i) => i.code));
  const autoByCode = new Map((remediations || []).map((r) => [r.code, r]));

  if (codes.has('articles_missing_images')) {
    const auto = autoByCode.get('articles_missing_images');
    steps.push({
      code: 'articles_missing_images',
      title: 'Stories missing photos',
      auto: auto?.detail || 'Queue image repair for each affected story and kick same-day repair for the newest ones.',
      manual: [
        `Confirm heroes appear on ${siteUrl}/article/<slug>.`,
        'If still blank after ~30 minutes, check article_image_repairs status in Supabase or re-run scripts/repair-article-images.js with APPLY_IMAGE_REPAIR=true.',
      ],
    });
  }

  for (const platform of PLATFORMS) {
    if (codes.has(`${platform}_missing_link`)) {
      steps.push({
        code: `${platform}_missing_link`,
        title: `${platform} posts without site URL`,
        auto: 'New posts now put the URL in the caption and log [link:...]. Older live posts are not rewritten automatically.',
        manual: [
          `Open the latest ${platform} post and confirm a Full story / site URL is visible.`,
          'If an old post is still link-free, add a page comment with the article URL or reshare once.',
        ],
      });
    }
    if (codes.has(`${platform}_quiet`)) {
      const auto = autoByCode.get(`${platform}_quiet`);
      steps.push({
        code: `${platform}_quiet`,
        title: `${platform} went quiet`,
        auto: auto?.detail || null,
        manual: [
          platform === 'facebook'
            ? 'Check Facebook feed drain / automate logs and FB_PAGE_ACCESS_TOKEN.'
            : `Check ${platform} credentials and recent failed rows on the post report.`,
          `Dashboard: ${siteUrl}/admin/post-report?key=${adminKey}`,
        ],
      });
    }
    if (codes.has(`${platform}_failures`)) {
      const failures = (report.platforms?.[platform]?.failures || []).join(' ');
      const pinterestAuth = platform === 'pinterest'
        && /authentication failed|invalid.?access.?token|re-authorize/i.test(failures);
      steps.push({
        code: `${platform}_failures`,
        title: `${platform} API failures`,
        auto: null,
        manual: pinterestAuth
          ? [
            `Re-authorize at ${siteUrl}/admin/pinterest-auth?key=${adminKey}`,
            'Copy new PINTEREST_ACCESS_TOKEN + PINTEREST_REFRESH_TOKEN into DigitalOcean, redeploy, then hit /admin/test-pinterest.',
          ]
          : [
            `Inspect the ${platform} error snippets below.`,
            `Dashboard: ${siteUrl}/admin/post-report?key=${adminKey}`,
          ],
      });
    }
  }

  return steps;
}

function buildAlertEmail(report, {
  siteUrl = 'https://thefloridabuzz.com',
  adminPassword = '',
  remediations = [],
} = {}) {
  const issues = report.issues || [];
  const allGood = issues.length === 0;
  const subject = allGood
    ? '✅ Florida Buzz — publishing self-check OK'
    : `⚠️ Florida Buzz — ${report.criticalCount} critical publishing issue${report.criticalCount === 1 ? '' : 's'}`;

  const platformRows = PLATFORMS.map((p) => {
    const s = report.platforms[p] || { success: 0, failed: 0, missingLink: 0 };
    let status = '🟢 OK';
    if (s.success === 0) status = '🔴 No successful posts';
    else if (s.missingLink > 0) status = '🔴 Missing links';
    else if (s.failed > 0) status = '🟡 Some failures';
    return `<tr>
      <td style="padding:8px 12px;text-transform:capitalize;font-weight:600;">${p}</td>
      <td style="padding:8px 12px;">${status}</td>
      <td style="padding:8px 12px;text-align:center;">${s.success}</td>
      <td style="padding:8px 12px;text-align:center;">${s.failed}</td>
      <td style="padding:8px 12px;text-align:center;">${s.missingLink || 0}</td>
    </tr>`;
  }).join('');

  const issueHtml = issues.length
    ? `<ul style="color:#b3261e;font-size:14px;">${issues.map((i) => `<li><strong>${i.severity}</strong> — ${i.message}</li>`).join('')}</ul>`
    : '<p style="color:#0a7a3e;">No publishing issues detected in this window.</p>';

  const missingImageHtml = (report.missingImages || []).length
    ? `<div style="margin-top:16px;padding:12px;background:#fde8e4;border-radius:8px;">
        <strong>Stories without photos</strong>
        <ul>${report.missingImages.slice(0, 12).map((a) =>
          `<li><a href="${siteUrl}/article/${a.slug}">${a.title || a.slug}</a>${a.published_at ? ` <span style="color:#666">(${a.published_at})</span>` : ''}</li>`
        ).join('')}</ul>
      </div>`
    : '';

  const failureDetails = PLATFORMS
    .filter((p) => (report.platforms[p]?.failures || []).length)
    .map((p) => `<p><strong>${p} errors:</strong><br>${report.platforms[p].failures.slice(0, 5).map((f) => `• ${String(f).slice(0, 220)}`).join('<br>')}</p>`)
    .join('');

  const missingLinkDetails = PLATFORMS
    .filter((p) => (report.platforms[p]?.missingLinkSamples || []).length)
    .map((p) => `<p><strong>${p} missing-link samples:</strong><br>${report.platforms[p].missingLinkSamples.map((f) => `• ${String(f).slice(0, 220)}`).join('<br>')}</p>`)
    .join('');

  const remediationSteps = buildRemediationSteps(report, { siteUrl, adminPassword, remediations });
  const remediationHtml = remediationSteps.length
    ? `<div style="margin-top:18px;padding:14px;background:#eef5f6;border-radius:8px;">
        <strong style="color:#0d3b3e;">Fix steps</strong>
        ${remediationSteps.map((step) => `
          <div style="margin-top:10px;font-size:13px;">
            <div style="font-weight:700;">${step.title}</div>
            ${step.auto ? `<div><em>Auto:</em> ${step.auto}</div>` : '<div><em>Auto:</em> none — needs a person or token refresh.</div>'}
            <ul style="margin:6px 0 0 18px;">${(step.manual || []).map((line) => `<li>${line}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>`
    : '';

  const autoResultsHtml = (remediations || []).length
    ? `<div style="margin-top:12px;padding:12px;background:#e8f5e9;border-radius:8px;font-size:13px;">
        <strong>Auto-remediation this run</strong>
        <ul>${remediations.map((r) => `<li>${r.ok ? '✅' : '⚠️'} ${r.detail}</li>`).join('')}</ul>
      </div>`
    : '';

  const adminKey = adminPassword || 'ADMIN_PASSWORD';
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#0d3b3e;">Florida Buzz publishing self-check</h2>
      <p style="color:#555;">Last ${report.lookbackHours}h · ${new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
      ${issueHtml}
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
        <thead>
          <tr style="background:#0d3b3e;color:white;">
            <th style="padding:8px 12px;text-align:left;">Platform</th>
            <th style="padding:8px 12px;text-align:left;">Status</th>
            <th style="padding:8px 12px;">✅</th>
            <th style="padding:8px 12px;">❌</th>
            <th style="padding:8px 12px;">🔗 miss</th>
          </tr>
        </thead>
        <tbody>${platformRows}</tbody>
      </table>
      ${missingImageHtml}
      ${autoResultsHtml}
      ${remediationHtml}
      ${failureDetails ? `<div style="margin-top:16px;font-size:13px;color:#b3261e;">${failureDetails}</div>` : ''}
      ${missingLinkDetails ? `<div style="margin-top:12px;font-size:13px;color:#b3261e;">${missingLinkDetails}</div>` : ''}
      <p style="margin-top:20px;font-size:12px;color:#999;">Dashboard: <a href="${siteUrl}/admin/post-report?key=${adminKey}">post report</a></p>
    </div>`;

  return { subject, html, allGood, remediationSteps };
}

module.exports = {
  PLATFORMS,
  LINK_MARKER_RE,
  buildAlertEmail,
  buildHealthReport,
  buildRemediationSteps,
  collectIssues,
  emptyPlatformSummary,
  findArticlesMissingImages,
  parseLinkMarker,
  summarizePostLog,
};
