'use strict';

const { EPISODE_STATUSES } = require('./config');

function requireString(value, field, { min = 1, max = 5000 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw new Error(`${field} must be between ${min} and ${max} characters`);
  }
  return text;
}

function optionalUrl(value, field) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${field} must be http(s)`);
  }
  return parsed.toString();
}

function requireUrl(value, field) {
  const url = optionalUrl(value, field);
  if (!url) throw new Error(`${field} is required`);
  return url;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseEpisodeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 100000) {
    throw new Error('episode_number must be a positive integer');
  }
  return num;
}

function assertStatus(status) {
  if (!EPISODE_STATUSES.includes(status)) {
    throw new Error(`Invalid episode status: ${status}`);
  }
  return status;
}

function assertTransition(from, to) {
  assertStatus(from);
  assertStatus(to);
  const allowed = {
    draft: ['draft', 'script_ready', 'failed'],
    script_ready: ['script_ready', 'generating_audio', 'draft', 'failed'],
    // script_ready allowed so gateway-timeout recoveries can retry fal TTS.
    generating_audio: ['preview_ready', 'failed', 'generating_audio', 'script_ready'],
    preview_ready: ['preview_ready', 'approved', 'generating_audio', 'script_ready', 'failed'],
    approved: ['approved', 'published', 'scheduled', 'preview_ready', 'failed'],
    scheduled: ['scheduled', 'published', 'approved', 'failed'],
    published: ['published', 'draft', 'approved'],
    failed: ['draft', 'script_ready', 'generating_audio', 'failed'],
  };
  if (!(allowed[from] || []).includes(to)) {
    throw new Error(`Cannot move episode from ${from} to ${to}`);
  }
  return to;
}

function validateSourceInput(body = {}) {
  return {
    title: requireString(body.title, 'source title', { max: 300 }),
    url: requireUrl(body.url, 'source url'),
    summary: String(body.summary || '').trim().slice(0, 2000) || null,
    included: body.included === false || body.included === 'false' ? false : true,
  };
}

function validateEpisodeFields(body = {}) {
  return {
    title: requireString(body.title, 'title', { max: 200 }),
    description: requireString(body.description || body.title, 'description', { max: 4000 }),
    show_notes_html: String(body.show_notes_html || '').slice(0, 50000),
    episode_number: parseEpisodeNumber(body.episode_number),
    artwork_alt: String(body.artwork_alt || '').trim().slice(0, 300) || null,
    slug: slugify(body.slug || body.title),
  };
}

function assertAudioUpload(file, maxBytes) {
  if (!file) throw new Error('Audio file is required');
  const type = String(file.mimetype || '');
  if (!['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'].includes(type) && !String(file.originalname || '').toLowerCase().endsWith('.mp3')) {
    throw new Error('Only MP3 audio uploads are allowed');
  }
  if (file.size > maxBytes) throw new Error('Audio file exceeds size limit');
  return true;
}

function assertArtworkUpload(file, maxBytes) {
  if (!file) throw new Error('Artwork file is required');
  const type = String(file.mimetype || '');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
    throw new Error('Artwork must be JPEG, PNG, or WebP');
  }
  if (file.size > maxBytes) throw new Error('Artwork file exceeds size limit');
  return true;
}

module.exports = {
  requireString,
  optionalUrl,
  requireUrl,
  slugify,
  parseEpisodeNumber,
  assertStatus,
  assertTransition,
  validateSourceInput,
  validateEpisodeFields,
  assertAudioUpload,
  assertArtworkUpload,
};
