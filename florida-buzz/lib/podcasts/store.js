'use strict';

const crypto = require('node:crypto');
const { DISNEY_SHOW_SLUG } = require('./config');
const { assertTransition } = require('./validation');
const { createMemoryStore } = require('./memoryStore');

async function checked(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

function createSupabaseStore(client) {
  if (!client) throw new Error('Supabase client required for podcast store');

  return {
    async listShows() {
      return checked(client.from('podcast_shows').select('*').order('title'));
    },
    async getShow(slug) {
      const rows = await checked(client.from('podcast_shows').select('*').eq('slug', slug).maybeSingle());
      return rows || null;
    },
    async listPlatformLinks(showId) {
      return checked(
        client.from('podcast_platform_links').select('*').eq('show_id', showId).order('sort_order')
      );
    },
    async upsertPlatformLink(showId, platform, url, sortOrder = 0) {
      const existing = await checked(
        client
          .from('podcast_platform_links')
          .select('*')
          .eq('show_id', showId)
          .eq('platform', platform)
          .maybeSingle()
      );
      if (existing) {
        return checked(
          client
            .from('podcast_platform_links')
            .update({ url, sort_order: sortOrder })
            .eq('id', existing.id)
            .select('*')
            .single()
        );
      }
      return checked(
        client
          .from('podcast_platform_links')
          .insert({ show_id: showId, platform, url, sort_order: sortOrder })
          .select('*')
          .single()
      );
    },
    async listPublishedEpisodes(showId) {
      return checked(
        client
          .from('podcast_episodes')
          .select('*')
          .eq('show_id', showId)
          .eq('status', 'published')
          .order('published_at', { ascending: false })
      );
    },
    async listEpisodes(showId) {
      return checked(
        client
          .from('podcast_episodes')
          .select('*')
          .eq('show_id', showId)
          .order('updated_at', { ascending: false })
      );
    },
    async getEpisode(showSlug, episodeSlug) {
      const show = await this.getShow(showSlug);
      if (!show) return null;
      return (
        (await checked(
          client
            .from('podcast_episodes')
            .select('*')
            .eq('show_id', show.id)
            .eq('slug', episodeSlug)
            .maybeSingle()
        )) || null
      );
    },
    async getEpisodeById(episodeId) {
      return (
        (await checked(client.from('podcast_episodes').select('*').eq('id', episodeId).maybeSingle())) || null
      );
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
      return checked(
        client
          .from('podcast_episodes')
          .insert({
            show_id: showId,
            slug: fields.slug,
            title: fields.title,
            description: fields.description,
            show_notes_html: fields.show_notes_html || '',
            episode_number: fields.episode_number,
            artwork_alt: fields.artwork_alt || null,
            status: 'draft',
            guid: `florida-buzz:${showId}:${fields.slug}:${crypto.randomUUID()}`,
          })
          .select('*')
          .single()
      );
    },
    async updateEpisode(episodeId, patch) {
      return checked(
        client
          .from('podcast_episodes')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', episodeId)
          .select('*')
          .single()
      );
    },
    async setStatus(episodeId, status) {
      const episode = await this.getEpisodeById(episodeId);
      if (!episode) throw new Error('Episode not found');
      assertTransition(episode.status, status);
      const patch = { status, updated_at: new Date().toISOString() };
      if (status === 'published' && !episode.published_at) patch.published_at = new Date().toISOString();
      if (status !== 'failed') patch.last_error = null;
      return this.updateEpisode(episodeId, patch);
    },
    async listSources(episodeId) {
      return checked(
        client
          .from('podcast_episode_sources')
          .select('*')
          .eq('episode_id', episodeId)
          .order('sort_order')
      );
    },
    async addSource(episodeId, source) {
      const existing = await this.listSources(episodeId);
      return checked(
        client
          .from('podcast_episode_sources')
          .insert({
            episode_id: episodeId,
            title: source.title,
            url: source.url,
            summary: source.summary,
            included: source.included !== false,
            sort_order: source.sort_order ?? existing.length,
            source_kind: source.source_kind || 'custom',
            external_ref: source.external_ref || null,
            meta: source.meta || {},
          })
          .select('*')
          .single()
      );
    },
    async setSourceIncluded(sourceId, included) {
      return checked(
        client
          .from('podcast_episode_sources')
          .update({ included: !!included })
          .eq('id', sourceId)
          .select('*')
          .single()
      );
    },
    async deleteSource(sourceId) {
      return checked(client.from('podcast_episode_sources').delete().eq('id', sourceId).select('*').single());
    },
    async getScheduleSettings(showSlug = DISNEY_SHOW_SLUG) {
      return (
        (await checked(
          client.from('podcast_schedule_settings').select('*').eq('show_slug', showSlug).maybeSingle()
        )) || null
      );
    },
    async upsertScheduleSettings(showSlug, patch) {
      const existing = await this.getScheduleSettings(showSlug);
      if (!existing) {
        return checked(
          client
            .from('podcast_schedule_settings')
            .insert({ show_slug: showSlug, ...patch, updated_at: new Date().toISOString() })
            .select('*')
            .single()
        );
      }
      return checked(
        client
          .from('podcast_schedule_settings')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('show_slug', showSlug)
          .select('*')
          .single()
      );
    },
    async createGenerationRun(fields) {
      return checked(
        client
          .from('podcast_generation_runs')
          .insert({
            show_slug: fields.show_slug,
            week_key: fields.week_key,
            status: fields.status || 'queued',
            attempt: fields.attempt || 1,
            episode_id: fields.episode_id || null,
            payload: fields.payload || {},
            error_detail: fields.error_detail || null,
          })
          .select('*')
          .single()
      );
    },
    async updateGenerationRun(runId, patch) {
      return checked(
        client
          .from('podcast_generation_runs')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', runId)
          .select('*')
          .single()
      );
    },
    async findGenerationRun(showSlug, weekKey, statuses = []) {
      let query = client
        .from('podcast_generation_runs')
        .select('*')
        .eq('show_slug', showSlug)
        .eq('week_key', weekKey)
        .order('attempt', { ascending: false })
        .limit(1);
      if (statuses.length) query = query.in('status', statuses);
      const rows = await checked(query);
      return rows[0] || null;
    },
    async listGenerationRuns(showSlug, weekKey = null, limit = 20) {
      let query = client
        .from('podcast_generation_runs')
        .select('*')
        .eq('show_slug', showSlug)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (weekKey) query = query.eq('week_key', weekKey);
      return checked(query);
    },
    async listFailedGenerationRuns(showSlug, limit = 20) {
      return checked(
        client
          .from('podcast_generation_runs')
          .select('*')
          .eq('show_slug', showSlug)
          .eq('status', 'failed')
          .order('updated_at', { ascending: false })
          .limit(limit)
      );
    },
    async saveScript(episodeId, kind, contentText, contentJson = null) {
      const existing = await checked(
        client
          .from('podcast_scripts')
          .select('version')
          .eq('episode_id', episodeId)
          .eq('kind', kind)
          .order('version', { ascending: false })
          .limit(1)
      );
      const version = (existing[0]?.version || 0) + 1;
      return checked(
        client
          .from('podcast_scripts')
          .insert({
            episode_id: episodeId,
            version,
            kind,
            content_text: contentText,
            content_json: contentJson,
          })
          .select('*')
          .single()
      );
    },
    async latestScript(episodeId, kind) {
      const rows = await checked(
        client
          .from('podcast_scripts')
          .select('*')
          .eq('episode_id', episodeId)
          .eq('kind', kind)
          .order('version', { ascending: false })
          .limit(1)
      );
      return rows[0] || null;
    },
    async createAsset(asset) {
      return checked(
        client
          .from('podcast_assets')
          .insert(asset)
          .select('*')
          .single()
      );
    },
    async createJob(episodeId, patch = {}) {
      return checked(
        client
          .from('podcast_audio_jobs')
          .insert({ episode_id: episodeId, status: 'queued', attempt: 1, ...patch })
          .select('*')
          .single()
      );
    },
    async updateJob(jobId, patch) {
      return checked(
        client
          .from('podcast_audio_jobs')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', jobId)
          .select('*')
          .single()
      );
    },
    async listJobs(episodeId) {
      return checked(
        client
          .from('podcast_audio_jobs')
          .select('*')
          .eq('episode_id', episodeId)
          .order('created_at', { ascending: false })
      );
    },
    async uploadBytes(bucket, path, bytes, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: true,
      });
      if (error) throw new Error(error.message);
      const { data } = client.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    },
    async sitemapEntries(siteUrl) {
      const entries = [
        { loc: `${siteUrl}/podcasts`, priority: '0.7' },
        { loc: `${siteUrl}/podcasts/${DISNEY_SHOW_SLUG}`, priority: '0.7' },
      ];
      const shows = await this.listShows();
      for (const show of shows) {
        const eps = await this.listPublishedEpisodes(show.id);
        for (const ep of eps) {
          entries.push({
            loc: `${siteUrl}/podcasts/${show.slug}/${ep.slug}`,
            lastmod: ep.published_at ? String(ep.published_at).slice(0, 10) : undefined,
            priority: '0.6',
          });
        }
      }
      return entries;
    },
  };
}

function createStore(client) {
  if (!client) return createMemoryStore();
  return createSupabaseStore(client);
}

module.exports = { createStore, createSupabaseStore, createMemoryStore };
