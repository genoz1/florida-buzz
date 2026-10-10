'use strict';

const { escapeHtml, plainTextFromHtml } = require('./sanitize');

function rfc2822(dateValue) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString();
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function absoluteUrl(site, maybeUrl) {
  if (!maybeUrl) return '';
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  return `${site}${maybeUrl.startsWith('/') ? '' : '/'}${maybeUrl}`;
}

function buildRss({ site, show, episodes }) {
  const showUrl = `${site}/podcasts/${show.slug}`;
  const feedUrl = `${showUrl}/rss.xml`;
  const cover = absoluteUrl(site, show.cover_url);
  const author = (show.hosts || []).map((h) => h.name).filter(Boolean).join(' & ') || show.publisher;
  const explicit = show.explicit ? 'true' : 'false';
  const channelDescription = [show.description, show.disclosure].filter(Boolean).join(' ');

  const items = (episodes || [])
    .filter((e) => e.status === 'published' && e.audio_url)
    .map((episode) => {
      const pageUrl = `${showUrl}/${episode.slug}`;
      const enclosureUrl = absoluteUrl(site, episode.audio_url);
      const description = escapeHtml(episode.description || plainTextFromHtml(episode.show_notes_html));
      const title = escapeHtml(episode.title);
      const bytes = Number(episode.audio_byte_size) > 0 ? Number(episode.audio_byte_size) : 1;
      const mime = episode.audio_content_type || 'audio/mpeg';
      const duration = formatDuration(episode.duration_seconds);
      const epArt = absoluteUrl(site, episode.artwork_url || show.cover_url);
      return `    <item>
      <title>${title}</title>
      <description>${description}</description>
      <itunes:summary>${description}</itunes:summary>
      <itunes:title>${title}</itunes:title>
      <itunes:episodeType>${episode.slug === 'trailer' ? 'trailer' : 'full'}</itunes:episodeType>
      ${episode.episode_number ? `<itunes:episode>${Number(episode.episode_number)}</itunes:episode>` : ''}
      <itunes:duration>${duration}</itunes:duration>
      <itunes:explicit>${explicit}</itunes:explicit>
      <itunes:image href="${escapeHtml(epArt)}" />
      <guid isPermaLink="false">${escapeHtml(episode.guid)}</guid>
      <pubDate>${rfc2822(episode.published_at || episode.updated_at)}</pubDate>
      <link>${escapeHtml(pageUrl)}</link>
      <enclosure url="${escapeHtml(enclosureUrl)}" length="${bytes}" type="${escapeHtml(mime)}" />
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeHtml(show.title)}</title>
    <link>${escapeHtml(showUrl)}</link>
    <atom:link href="${escapeHtml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeHtml(channelDescription)}</description>
    <language>${escapeHtml(show.language || 'en-us')}</language>
    <copyright>${escapeHtml(show.publisher)}</copyright>
    <managingEditor>floridabuzzonline@gmail.com (${escapeHtml(author)})</managingEditor>
    <itunes:author>${escapeHtml(author)}</itunes:author>
    <itunes:summary>${escapeHtml(channelDescription)}</itunes:summary>
    <itunes:explicit>${explicit}</itunes:explicit>
    <itunes:owner>
      <itunes:name>${escapeHtml(show.publisher)}</itunes:name>
      <itunes:email>floridabuzzonline@gmail.com</itunes:email>
    </itunes:owner>
    <itunes:image href="${escapeHtml(cover)}" />
    <itunes:category text="${escapeHtml(show.category || 'Leisure')}">
      ${show.subcategory ? `<itunes:category text="${escapeHtml(show.subcategory)}" />` : ''}
    </itunes:category>
    <itunes:type>episodic</itunes:type>
${items}
  </channel>
</rss>
`;
}

module.exports = { buildRss, formatDuration, absoluteUrl, rfc2822 };
