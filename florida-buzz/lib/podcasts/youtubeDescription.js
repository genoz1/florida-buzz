'use strict';

/**
 * Build YouTube video descriptions with real URLs.
 * stripHtml alone drops <a href> targets — promised podcast links must stay.
 */

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return decodeEntities(
    String(value || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function extractHtmlLinks(html) {
  const links = [];
  const seen = new Set();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(String(html || '')))) {
    const url = decodeEntities(match[1]).trim();
    const title = stripTags(match[2]).replace(/\s+/g, ' ').trim() || url;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ title: title.slice(0, 120), url });
  }
  return links;
}

function linksFromSources(sources = []) {
  const links = [];
  const seen = new Set();
  for (const source of sources) {
    if (source?.included === false) continue;
    const url = String(source?.url || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({
      title: String(source.title || url).replace(/\s+/g, ' ').trim().slice(0, 120),
      url,
    });
  }
  return links;
}

function shortBlurb(episode) {
  const fromDesc = stripTags(episode?.description || '').split(/\n+/).map((line) => line.trim()).filter(Boolean)[0];
  if (fromDesc && fromDesc.length > 40) return fromDesc.slice(0, 400);
  const fromNotes = stripTags(episode?.show_notes_html || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^florida buzz resources/i.test(line) && !/^direct links/i.test(line));
  return (fromNotes[0] || 'Florida Buzz: Disney World news with Geno.').slice(0, 400);
}

/**
 * YouTube description contract:
 * 1) Florida Buzz homepage first
 * 2) Episode page
 * 3) Like & subscribe CTA
 * 4) Short blurb
 * 5) Promised episode links (from show notes / sources)
 * 6) Disclosure
 */
function buildYoutubeDescription({
  episode,
  show,
  site = 'https://thefloridabuzz.com',
  sources = [],
  maxChars = 4900,
} = {}) {
  const root = String(site || 'https://thefloridabuzz.com').replace(/\/$/, '');
  const episodeUrl = `${root}/podcasts/${show?.slug || 'florida-buzz-disney'}/${episode?.slug || ''}`.replace(/\/$/, '');
  const htmlLinks = extractHtmlLinks(episode?.show_notes_html || '');
  const sourceLinks = linksFromSources(sources);
  const merged = [];
  const seen = new Set();
  for (const link of [...htmlLinks, ...sourceLinks]) {
    if (seen.has(link.url)) continue;
    // Homepage / episode page are already in the header — skip duplicates in the list.
    if (link.url === root || link.url === `${root}/` || link.url === episodeUrl) continue;
    seen.add(link.url);
    merged.push(link);
  }

  const lines = [
    root,
    episodeUrl,
    '',
    'If you enjoy Florida Buzz, like and subscribe — it really helps the show.',
    '',
    shortBlurb(episode),
    '',
  ];

  if (merged.length) {
    lines.push('Links from this episode:');
    for (const link of merged) {
      lines.push(`• ${link.title}`);
      lines.push(`  ${link.url}`);
    }
    lines.push('');
  } else {
    lines.push('Read more and find every link from this episode on The Florida Buzz.');
    lines.push('');
  }

  lines.push('Florida Buzz is not affiliated with or endorsed by Disney.');

  let description = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (description.length > maxChars) {
    // Keep the header + CTA + as many links as fit.
    const header = [
      root,
      episodeUrl,
      '',
      'If you enjoy Florida Buzz, like and subscribe — it really helps the show.',
      '',
      shortBlurb(episode),
      '',
      'Links from this episode:',
    ].join('\n');
    const footer = '\n\nFlorida Buzz is not affiliated with or endorsed by Disney.';
    let body = header;
    for (const link of merged) {
      const chunk = `\n• ${link.title}\n  ${link.url}`;
      if (body.length + chunk.length + footer.length > maxChars) break;
      body += chunk;
    }
    description = `${body}${footer}`.slice(0, maxChars);
  }
  return description;
}

module.exports = {
  buildYoutubeDescription,
  decodeEntities,
  extractHtmlLinks,
  linksFromSources,
  shortBlurb,
  stripTags,
};
