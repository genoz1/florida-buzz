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

function buildAlertEmail(report, {
  siteUrl = 'https://thefloridabuzz.com',
  adminPassword = '',
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
      ${failureDetails ? `<div style="margin-top:16px;font-size:13px;color:#b3261e;">${failureDetails}</div>` : ''}
      ${missingLinkDetails ? `<div style="margin-top:12px;font-size:13px;color:#b3261e;">${missingLinkDetails}</div>` : ''}
      <p style="margin-top:20px;font-size:12px;color:#999;">Dashboard: <a href="${siteUrl}/admin/post-report?key=${adminKey}">post report</a></p>
    </div>`;

  return { subject, html, allGood };
}

module.exports = {
  PLATFORMS,
  LINK_MARKER_RE,
  buildAlertEmail,
  buildHealthReport,
  collectIssues,
  emptyPlatformSummary,
  findArticlesMissingImages,
  parseLinkMarker,
  summarizePostLog,
};
