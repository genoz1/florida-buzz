'use strict';

const EVERGREEN_TOPICS = Object.freeze([
  {
    slug: 'favorite-resorts',
    title: 'Favorite Walt Disney World resorts for families',
    summary: 'Which resorts the hosts keep recommending and why location vs value matters.',
  },
  {
    slug: 'overrated-attractions',
    title: 'Attractions that feel overrated (and which ones still deliver)',
    summary: 'Honest takes on hyped rides versus quieter gems worth the time.',
  },
  {
    slug: 'planning-mistakes',
    title: 'Common Disney World planning mistakes locals still see',
    summary: 'Dining reservations, park hopping, rope drop, and packing missteps.',
  },
  {
    slug: 'best-family-restaurants',
    title: 'Best restaurants for families with kids',
    summary: 'Quick service vs table service tradeoffs and kid-friendly picks.',
  },
  {
    slug: 'busy-day-strategies',
    title: 'Strategies for busy park days',
    summary: 'Crowd navigation, rest breaks, mobile order timing, and exit plans.',
  },
  {
    slug: 'transportation-preferences',
    title: 'Transportation preferences around the resorts',
    summary: 'Buses, Skyliner, monorail, walking, rideshare — when each wins.',
  },
  {
    slug: 'seasonal-events',
    title: 'Seasonal events worth planning around',
    summary: 'Festival vibes, parties, weather seasons, and what is worth the ticket.',
  },
  {
    slug: 'long-wait-worth-it',
    title: 'Attractions worth a long wait',
    summary: 'When a long queue is still a yes for the hosts and their families.',
  },
  {
    slug: 'things-we-would-change',
    title: 'Things the hosts would change at the parks',
    summary: 'Opinion segment on guest flow, dining, and family-friendly tweaks.',
  },
]);

function pickEvergreenTopic(excludeSlugs = [], weekKey = '') {
  const excluded = new Set(excludeSlugs);
  const available = EVERGREEN_TOPICS.filter((t) => !excluded.has(t.slug));
  const pool = available.length ? available : EVERGREEN_TOPICS.slice();
  let hash = 0;
  for (const ch of String(weekKey)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length];
}

module.exports = { EVERGREEN_TOPICS, pickEvergreenTopic };
