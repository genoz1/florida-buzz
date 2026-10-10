'use strict';

const crypto = require('node:crypto');
const { DISNEY_SHOW_SLUG } = require('./config');
const { assertTransition } = require('./validation');

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

const DEFAULT_DISCLOSURE =
  'This is an unofficial fan podcast and is not affiliated with, endorsed by, or sponsored by The Walt Disney Company.';

function seedShow() {
  return {
    id: id(),
    slug: DISNEY_SHOW_SLUG,
    title: 'Florida Buzz: Disney',
    publisher: 'The Florida Buzz',
    description:
      'Gina and Diane are Disney-loving Central Florida moms who visit the parks frequently and discuss park news, attractions, food, resorts, events, planning advice, and their personal experiences.',
    hosts: [{ name: 'Gina', role: 'host' }, { name: 'Diane', role: 'host' }],
    disclosure: DEFAULT_DISCLOSURE,
    language: 'en-us',
    category: 'Leisure',
    subcategory: 'Travel',
    explicit: false,
    cover_asset_id: null,
    cover_url: '/img/podcasts/florida-buzz-disney-cover.svg',
    cover_alt: 'Florida Buzz: Disney podcast cover — original Florida Buzz artwork, not affiliated with Disney',
    intro_audio_url: null,
    outro_audio_url: null,
    created_at: now(),
    updated_at: now(),
  };
}

function createMemoryStore() {
  const state = {
    shows: [seedShow()],
    platformLinks: [],
    assets: [],
    episodes: [],
    sources: [],
    scripts: [],
    jobs: [],
  };

  function showBySlug(slug) {
    return state.shows.find((s) => s.slug === slug) || null;
  }

  function episodeById(episodeId) {
    return state.episodes.find((e) => e.id === episodeId) || null;
  }

  return {
    async listShows() {
      return state.shows.slice().sort((a, b) => a.title.localeCompare(b.title));
    },
    async getShow(slug) {
      return showBySlug(slug);
    },
    async listPlatformLinks(showId) {
      return state.platformLinks.filter((l) => l.show_id === showId).sort((a, b) => a.sort_order - b.sort_order);
    },
    async listPublishedEpisodes(showId) {
      return state.episodes
        .filter((e) => e.show_id === showId && e.status === 'published')
        .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
    },
    async listEpisodes(showId) {
      return state.episodes
        .filter((e) => e.show_id === showId)
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    },
    async getEpisode(showSlug, episodeSlug) {
      const show = showBySlug(showSlug);
      if (!show) return null;
      return state.episodes.find((e) => e.show_id === show.id && e.slug === episodeSlug) || null;
    },
    async getEpisodeById(episodeId) {
      return episodeById(episodeId);
    },
    async getPublishedNeighbors(showId, publishedAt) {
      const published = await this.listPublishedEpisodes(showId);
      const idx = published.findIndex((e) => e.published_at === publishedAt);
      return {
        newer: idx > 0 ? published[idx - 1] : null,
        older: idx >= 0 && idx < published.length - 1 ? published[idx + 1] : null,
      };
    },
    async createEpisode(showId, fields) {
      const episode = {
        id: id(),
        show_id: showId,
        slug: fields.slug,
        title: fields.title,
        description: fields.description,
        show_notes_html: fields.show_notes_html || '',
        episode_number: fields.episode_number,
        status: 'draft',
        outline_json: null,
        script_text: null,
        artwork_asset_id: null,
        artwork_url: null,
        artwork_alt: fields.artwork_alt || null,
        audio_asset_id: null,
        audio_url: null,
        audio_byte_size: null,
        audio_content_type: 'audio/mpeg',
        duration_seconds: null,
        guid: `florida-buzz:${showId}:${fields.slug}:${id()}`,
        published_at: null,
        scheduled_for: null,
        last_error: null,
        created_at: now(),
        updated_at: now(),
      };
      state.episodes.push(episode);
      return episode;
    },
    async updateEpisode(episodeId, patch) {
      const episode = episodeById(episodeId);
      if (!episode) throw new Error('Episode not found');
      Object.assign(episode, patch, { updated_at: now() });
      return episode;
    },
    async setStatus(episodeId, status) {
      const episode = episodeById(episodeId);
      if (!episode) throw new Error('Episode not found');
      assertTransition(episode.status, status);
      episode.status = status;
      episode.updated_at = now();
      if (status === 'published' && !episode.published_at) episode.published_at = now();
      if (status !== 'failed') episode.last_error = null;
      return episode;
    },
    async listSources(episodeId) {
      return state.sources
        .filter((s) => s.episode_id === episodeId)
        .sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)));
    },
    async addSource(episodeId, source) {
      const row = {
        id: id(),
        episode_id: episodeId,
        title: source.title,
        url: source.url,
        summary: source.summary,
        included: source.included !== false,
        sort_order: source.sort_order || state.sources.filter((s) => s.episode_id === episodeId).length,
        created_at: now(),
      };
      state.sources.push(row);
      return row;
    },
    async setSourceIncluded(sourceId, included) {
      const row = state.sources.find((s) => s.id === sourceId);
      if (!row) throw new Error('Source not found');
      row.included = !!included;
      return row;
    },
    async saveScript(episodeId, kind, contentText, contentJson = null) {
      const versions = state.scripts.filter((s) => s.episode_id === episodeId && s.kind === kind);
      const version = versions.length + 1;
      const row = {
        id: id(),
        episode_id: episodeId,
        version,
        kind,
        content_text: contentText,
        content_json: contentJson,
        created_at: now(),
      };
      state.scripts.push(row);
      return row;
    },
    async latestScript(episodeId, kind) {
      return state.scripts
        .filter((s) => s.episode_id === episodeId && s.kind === kind)
        .sort((a, b) => b.version - a.version)[0] || null;
    },
    async createAsset(asset) {
      const row = {
        id: id(),
        kind: asset.kind,
        storage_path: asset.storage_path,
        public_url: asset.public_url,
        content_type: asset.content_type,
        byte_size: asset.byte_size || null,
        duration_seconds: asset.duration_seconds || null,
        alt_text: asset.alt_text || null,
        checksum: asset.checksum || null,
        created_at: now(),
      };
      state.assets.push(row);
      return row;
    },
    async createJob(episodeId, patch = {}) {
      const row = {
        id: id(),
        episode_id: episodeId,
        status: 'queued',
        attempt: 1,
        section_index: 0,
        section_count: 1,
        fal_request_id: null,
        fal_endpoint: null,
        fal_model: null,
        estimated_cost_usd: null,
        actual_cost_usd: null,
        error_detail: null,
        result: null,
        created_at: now(),
        updated_at: now(),
        ...patch,
      };
      state.jobs.push(row);
      return row;
    },
    async updateJob(jobId, patch) {
      const job = state.jobs.find((j) => j.id === jobId);
      if (!job) throw new Error('Job not found');
      Object.assign(job, patch, { updated_at: now() });
      return job;
    },
    async listJobs(episodeId) {
      return state.jobs
        .filter((j) => j.episode_id === episodeId)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    async sitemapEntries(siteUrl) {
      const entries = [
        { loc: `${siteUrl}/podcasts`, priority: '0.7' },
        { loc: `${siteUrl}/podcasts/${DISNEY_SHOW_SLUG}`, priority: '0.7' },
      ];
      for (const show of state.shows) {
        for (const ep of await this.listPublishedEpisodes(show.id)) {
          entries.push({
            loc: `${siteUrl}/podcasts/${show.slug}/${ep.slug}`,
            lastmod: ep.published_at ? String(ep.published_at).slice(0, 10) : undefined,
            priority: '0.6',
          });
        }
      }
      return entries;
    },
    _state: state,
  };
}

module.exports = { createMemoryStore, DEFAULT_DISCLOSURE };
