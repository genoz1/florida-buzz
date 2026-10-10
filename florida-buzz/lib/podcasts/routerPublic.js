'use strict';

const express = require('express');
const { buildRss } = require('./rss');
const { DISNEY_SHOW_SLUG } = require('./config');
const { sanitizeShowNotesHtml } = require('./sanitize');

function createPublicRouter({ store, cfg }) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const shows = await store.listShows();
      const cards = [];
      for (const show of shows) {
        const episodes = await store.listPublishedEpisodes(show.id);
        cards.push({ show, latest: episodes[0] || null, episodeCount: episodes.length });
      }
      res.render('podcasts', {
        pageTitle: 'Podcasts — The Florida Buzz',
        category: null,
        tickerItems: [],
        canonicalPath: '/podcasts',
        isPodcastsPage: true,
        cards,
        siteUrl: cfg.site,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:showSlug/rss.xml', async (req, res, next) => {
    try {
      const show = await store.getShow(req.params.showSlug);
      if (!show) return res.status(404).render('404');
      const episodes = await store.listPublishedEpisodes(show.id);
      const xml = buildRss({ site: cfg.site, show, episodes });
      res.set('Content-Type', 'application/rss+xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(xml);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:showSlug', async (req, res, next) => {
    try {
      const show = await store.getShow(req.params.showSlug);
      if (!show) return res.status(404).render('404');
      const episodes = await store.listPublishedEpisodes(show.id);
      const links = await store.listPlatformLinks(show.id);
      res.render('podcast-show', {
        pageTitle: `${show.title} — The Florida Buzz`,
        pageDescription: show.description,
        category: null,
        tickerItems: [],
        canonicalPath: `/podcasts/${show.slug}`,
        isPodcastsPage: true,
        pageImage: show.cover_url && show.cover_url.startsWith('http') ? show.cover_url : `${cfg.site}${show.cover_url || ''}`,
        show,
        episodes,
        links,
        latest: episodes[0] || null,
        siteUrl: cfg.site,
        rssPath: `/podcasts/${show.slug}/rss.xml`,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:showSlug/:episodeSlug', async (req, res, next) => {
    try {
      const show = await store.getShow(req.params.showSlug);
      if (!show) return res.status(404).render('404');
      const episode = await store.getEpisode(req.params.showSlug, req.params.episodeSlug);
      if (!episode || episode.status !== 'published') return res.status(404).render('404');
      const sources = (await store.listSources(episode.id)).filter((s) => s.included);
      const neighbors = await store.getPublishedNeighbors(show.id, episode.published_at);
      res.render('podcast-episode', {
        pageTitle: `${episode.title} — ${show.title}`,
        pageDescription: episode.description,
        category: null,
        tickerItems: [],
        canonicalPath: `/podcasts/${show.slug}/${episode.slug}`,
        isPodcastsPage: true,
        pageImage:
          (episode.artwork_url && episode.artwork_url.startsWith('http')
            ? episode.artwork_url
            : episode.artwork_url
              ? `${cfg.site}${episode.artwork_url}`
              : show.cover_url && show.cover_url.startsWith('http')
                ? show.cover_url
                : `${cfg.site}${show.cover_url || ''}`),
        show,
        episode: {
          ...episode,
          show_notes_html: sanitizeShowNotesHtml(episode.show_notes_html),
        },
        sources,
        newer: neighbors.newer,
        older: neighbors.older,
        siteUrl: cfg.site,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPublicRouter, DISNEY_SHOW_SLUG };
