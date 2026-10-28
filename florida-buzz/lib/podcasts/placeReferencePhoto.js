'use strict';

/**
 * Find a real place photograph to anchor YouTube still generation.
 * Prefer Florida Buzz article heroes first (AI heroes used as-is later; sourced
 * photos used as photorealistic AI references). Wikimedia Commons is backup.
 * Never invent image URLs — only return photos actually retrieved from these sources.
 */

const { articleImageOrigin, isUsableArticleImage } = require('../articleImages');

const USER_AGENT = 'FloridaBuzzBot/1.0 (podcast place references; https://thefloridabuzz.com)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const REJECT_TITLE =
  /\b(logo|map|diagram|icon|seal|flag|svg|screenshot|poster|signage mock|clip art|wordmark|emblem|coat of arms)\b/i;

/** Article heroes that are people/panels — never use these as place templates. */
const PEOPLE_PRIMARY =
  /\b(panel|panels|interview|speaker|speakers|host|hosts|portrait|portraits|keynote|moderator|audience seated|talk show|gold theater guests?)\b/i;

const LICENSE_OK =
  /public domain|cc0|cc[- ]?by|creative commons attribution|pdm|pd[- ]old|no rights reserved/i;

function stripTracking(url) {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '').split('?')[0];
  }
}

function looksLikePeoplePrimaryText(...parts) {
  const hay = parts.map((part) => String(part || '')).join(' ');
  return PEOPLE_PRIMARY.test(hay);
}

const PLACE_NAME_PATTERNS = [
  /\bDisney'?s?\s+Board\s*-?\s*Walk(?:\s+Inn|\s+Villas)?\b/i,
  /\bContemporary(?:\s+Resort)?\b/i,
  /\bMagic Kingdom(?:\s+entrance|\s+railroad|\s+train station)?\b/i,
  /\bCinderella Castle\b/i,
  /\bSpaceship Earth\b/i,
  /\bEPCOT\b/i,
  /\bHollywood Studios\b/i,
  /\bAnimal Kingdom\b/i,
  /\bPandora\b/i,
  /\bGertie\b/i,
  /\bEcho Lake\b/i,
  /\bDisney Springs\b/i,
  /\bWorld of Disney\b/i,
  /\bmonorail\b/i,
  /\bMain Street(?:\s*,?\s*U\.?S\.?A\.?|\s+USA)?\b/i,
  /\bSpace Mountain\b/i,
  /\bTomorrowland\b/i,
  /\bWorld Showcase\b/i,
  /\bD23(?:\s+Expo)?\b/i,
  /\bGold Theater\b/i,
];

/** Known Commons files when search misses (bag/security stories, Main Street, etc.). */
const CURATED_COMMONS_FILES = [
  {
    match: /\bmain street\b/i,
    titles: [
      'File:Walt Disney World Railroad Main Street USA Station 01.jpg',
      'File:Magic Kingdom - Main Street and Trolley.jpg',
    ],
  },
  {
    match: /\b(magic kingdom|cinderella castle)\b/i,
    titles: [
      'File:Cinderella Castle, Magic Kingdom Walt Disney World (2024).jpg',
      'File:Magic Kingdom - Main Street and Trolley.jpg',
    ],
  },
  {
    match: /\b(spaceship earth|epcot)\b/i,
    titles: ['File:Spaceship Earth, Epcot en janvier 2022 (4).jpg'],
  },
  {
    match: /\b(board\s*-?\s*walk)\b/i,
    titles: ["File:Disney's BoardWalk Inn, Walt Disney World Resort, Orlando, Florida (15631367141).jpg"],
  },
];

/** Pull a concrete place override out of admin reject/redo direction text. */
function extractPlaceFromDirection(direction = '') {
  const text = String(direction || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const hints = [];
  for (const re of PLACE_NAME_PATTERNS) {
    const match = text.match(re);
    if (match) hints.push(match[0]);
  }
  if (hints.length) return [...new Set(hints)].join(' ').slice(0, 120);
  // Generic park wording from admin direction (D23 fallbacks, etc.)
  if (/\binside\b.*\bdisney parks?\b|\bdisney parks?\b.*\binside\b|\bphoto\s*realistic\b.*\bdisney\b/i.test(text)) {
    return 'Walt Disney World Magic Kingdom Tomorrowland';
  }
  if (/\bdisney parks?\b|\bwalt disney world\b/i.test(text)) {
    return 'Walt Disney World park exterior';
  }
  // Short free-text direction that names a subject ("change to space mountain exterior")
  const cleaned = text
    .replace(/^(change\s+to|use|show|make\s+it|redo\s+as|create\s+a)\s+/i, '')
    .replace(/\b(photo\s*realistic|cinematic|illustration|image|picture)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 4 ? cleaned.slice(0, 120) : '';
}

function buildPlaceSearchQuery({ label = '', category = '', prompt = '', direction = '' } = {}) {
  const directionPlace = extractPlaceFromDirection(direction);
  const raw = `${direction} ${directionPlace} ${label} ${prompt} ${category}`.replace(/\s+/g, ' ').trim();
  const placeHints = [];
  for (const re of PLACE_NAME_PATTERNS) {
    const match = raw.match(re);
    if (match) placeHints.push(match[0]);
  }
  // Admin direction wins — put its place first and skip story remaps that fight it.
  if (directionPlace) {
    placeHints.unshift(directionPlace);
  }
  const directionOverridesPlace = Boolean(directionPlace);
  // Prefer entrance/railroad wording when ticketing / Premier Pass is the story.
  if (
    !directionOverridesPlace
    && /\b(premier pass|lightning lane|ticket|ticketing|tapstile|turnstile)\b/i.test(raw)
    && !/\bentrance|railroad|train station|space mountain\b/i.test(placeHints.join(' '))
  ) {
    placeHints.unshift('Magic Kingdom entrance railroad station');
  }
  if (!directionOverridesPlace && /\b(cold grocery|bell services|grocery transfer)\b/i.test(raw)) {
    placeHints.unshift("Disney's Contemporary Resort monorail");
  }
  if (!directionOverridesPlace && /\b(wine\s*&\s*dine|rundisney|run disney|race weekend)\b/i.test(raw)) {
    placeHints.unshift('EPCOT Spaceship Earth race');
  }
  if (!directionOverridesPlace && /\bspirit jersey/i.test(raw)) {
    placeHints.unshift('World of Disney Disney Springs');
  }
  // Bag / security / prohibited items stories → Main Street / park entrance (not abstract "restrictions").
  if (
    !directionOverridesPlace
    && /\b(bag|bags|backpack|security|prohibited|restricted items?|park bag)\b/i.test(raw)
    && !/\bmain street|entrance|railroad|magic kingdom\b/i.test(placeHints.join(' '))
  ) {
    placeHints.unshift('Magic Kingdom Main Street USA entrance');
  }
  const labelCore = directionOverridesPlace
    ? ''
    : String(label || '')
        .replace(/\$\d+(?:\.\d+)?/g, ' ')
        .replace(/\b(premier pass|lightning lane|road closures?|wine\s*&\s*dine|rundisney|run disney|cold grocery transfers?|gold theater panels?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
  const parts = [...new Set([
    ...placeHints,
    labelCore,
    'Walt Disney World',
  ].filter((part) => part && part.length >= 3))];
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function titleLooksUseful(title = '') {
  const t = String(title || '');
  if (!t) return false;
  if (REJECT_TITLE.test(t)) return false;
  if (!/\b(disney|epcot|magic kingdom|hollywood|animal kingdom|board\s*-?\s*walk|contemporary|monorail|gertie|echo lake|spaceship)\b/i.test(t)
    && !/\bwalt disney world\b/i.test(t)) {
    // Allow if query already scoped; still prefer Disney-tagged files.
    return true;
  }
  return true;
}

function licenseLooksOk(extmetadata = {}) {
  const license = String(
    extmetadata.LicenseShortName?.value
      || extmetadata.License?.value
      || extmetadata.UsageTerms?.value
      || ''
  );
  const permission = String(extmetadata.Permission?.value || '');
  const hay = `${license} ${permission}`;
  if (!hay.trim()) return true; // Commons files usually have metadata; allow if missing rather than starve.
  if (/fair use|noncommercial|no derivative|all rights reserved/i.test(hay) && !LICENSE_OK.test(hay)) {
    return false;
  }
  return LICENSE_OK.test(hay) || /public domain/i.test(hay) || /^cc/i.test(license);
}

function creditFromMeta(title, extmetadata = {}) {
  const artist = String(extmetadata.Artist?.value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const license = String(extmetadata.LicenseShortName?.value || extmetadata.License?.value || 'Wikimedia Commons')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  const file = String(title || '').replace(/^File:/i, '');
  return [artist || 'Unknown photographer', license, 'via Wikimedia Commons', file].filter(Boolean).join('; ');
}

async function fetchImageBuffer(url, fetchImpl = fetch) {
  const res = await fetchImpl(stripTracking(url), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Reference photo fetch HTTP ${res.status}`);
  const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime && !/^image\/(jpeg|jpg|png|webp)$/.test(mime)) {
    throw new Error(`Reference photo unsupported type ${mime}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 8_000) throw new Error('Reference photo too small');
  if (buffer.length > 45 * 1024 * 1024) throw new Error('Reference photo too large');
  return { buffer, mimeType: mime || 'image/jpeg' };
}

function pageToCandidate(page) {
  const info = (page.imageinfo || [])[0] || {};
  return {
    title: page.title || '',
    url: info.thumburl || info.url || '',
    mime: String(info.mime || '').toLowerCase(),
    width: Number(info.thumbwidth || info.width || 0),
    height: Number(info.thumbheight || info.height || 0),
    size: Number(info.size || 0),
    extmetadata: info.extmetadata || {},
  };
}

function candidateIsUsable(item) {
  return Boolean(
    item.url
    && /^image\/(jpeg|jpg|png|webp)$/.test(item.mime)
    && titleLooksUseful(item.title)
    && licenseLooksOk(item.extmetadata)
    && (item.width >= 800 || item.size >= 80_000)
  );
}

async function downloadWikimediaCandidate(item, query, fetchImpl) {
  const downloaded = await fetchImageBuffer(item.url, fetchImpl);
  return {
    source: 'wikimedia',
    query: String(query || ''),
    title: item.title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
    imageUrl: stripTracking(item.url),
    credit: creditFromMeta(item.title, item.extmetadata),
    buffer: downloaded.buffer,
    mimeType: downloaded.mimeType,
  };
}

async function fetchWikimediaFileByTitle(title, { fetchImpl = fetch, query = '' } = {}) {
  const fileTitle = String(title || '').trim();
  if (!fileTitle) return null;
  const params = new URLSearchParams({
    action: 'query',
    titles: fileTitle,
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  });
  const res = await fetchImpl(`${COMMONS_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Wikimedia file lookup HTTP ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {});
  for (const page of pages) {
    if (page.missing != null) continue;
    const item = pageToCandidate(page);
    if (!candidateIsUsable(item)) continue;
    try {
      return await downloadWikimediaCandidate(item, query || fileTitle, fetchImpl);
    } catch (err) {
      console.warn(`[podcasts] Curated Wikimedia file failed (${item.title}): ${err.message}`);
    }
  }
  return null;
}

async function searchWikimediaPlacePhoto(query, { fetchImpl = fetch, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (q.length < 4) return null;
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(20, Math.max(3, limit))),
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  });
  const res = await fetchImpl(`${COMMONS_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Wikimedia search HTTP ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {});
  const ranked = pages
    .map(pageToCandidate)
    .filter(candidateIsUsable)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));

  for (const item of ranked.slice(0, 5)) {
    try {
      return await downloadWikimediaCandidate(item, q, fetchImpl);
    } catch (err) {
      console.warn(`[podcasts] Wikimedia candidate failed (${item.title}): ${err.message}`);
    }
  }
  return null;
}

/** Extra queries when the primary search returns nothing (admin direction / thin labels). */
function placeSearchFallbacks({ label = '', prompt = '', direction = '', primaryQuery = '' } = {}) {
  const directionPlace = extractPlaceFromDirection(direction);
  const hay = `${direction} ${directionPlace} ${label} ${prompt} ${primaryQuery}`;
  const out = [];
  const push = (q) => {
    const cleaned = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (cleaned.length >= 4 && !out.includes(cleaned)) out.push(cleaned);
  };
  if (directionPlace) {
    push(`${directionPlace} Walt Disney World`);
    push(`${directionPlace} Magic Kingdom`);
    push(directionPlace);
  }
  if (/\bmain street\b/i.test(hay)) {
    push('Main Street USA Magic Kingdom');
    push('Magic Kingdom Main Street Walt Disney World');
  }
  if (/\b(bag|bags|backpack|security|prohibited|restricted items?|park bag)\b/i.test(hay)) {
    push('Magic Kingdom Main Street USA');
    push('Magic Kingdom entrance railroad station');
  }
  if (!directionPlace && label) {
    push(`${label} Walt Disney World`);
  }
  // Last resort so thin labels still get a real WDW place photo.
  push('Magic Kingdom Main Street Walt Disney World');
  push('Cinderella Castle Magic Kingdom Walt Disney World');
  return out.filter((q) => q !== String(primaryQuery || '').trim());
}

async function curatedWikimediaFallback(hay, fetchImpl) {
  const text = String(hay || '');
  for (const entry of CURATED_COMMONS_FILES) {
    if (!entry.match.test(text)) continue;
    for (const title of entry.titles) {
      const hit = await fetchWikimediaFileByTitle(title, { fetchImpl, query: text }).catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function overlapScore(a, b) {
  const aw = new Set(normalizeMatchText(a).split(' ').filter((w) => w.length > 2));
  const bw = new Set(normalizeMatchText(b).split(' ').filter((w) => w.length > 2));
  if (!aw.size || !bw.size) return 0;
  let hit = 0;
  for (const word of aw) if (bw.has(word)) hit += 1;
  return hit / Math.max(aw.size, bw.size);
}

async function findArticleHeroReference({
  label = '',
  episodeId,
  store,
  supabase,
  fetchImpl = fetch,
} = {}) {
  if (!episodeId || !store?.listSources || !supabase) return null;
  const sources = await store.listSources(episodeId);
  const articles = (sources || []).filter(
    (source) => source.source_kind === 'article' && source.included !== false && (source.meta?.slug || source.url)
  );
  if (!articles.length) return null;

  const ranked = articles
    .map((source) => ({
      source,
      score: Math.max(
        overlapScore(label, source.title),
        overlapScore(label, source.meta?.slug || '')
      ),
    }))
    .filter((row) => row.score >= 0.25)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;

  for (const row of ranked.slice(0, 3)) {
    const slug = row.source.meta?.slug;
    let imageUrl = null;
    let title = row.source.title;
    if (looksLikePeoplePrimaryText(row.source.title, slug, label)) {
      console.warn(`[podcasts] Skipping people-primary article candidate for place reference: ${row.source.title}`);
      continue;
    }
    if (slug) {
      const { data, error } = await supabase
        .from('articles')
        .select('image_url,title,slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new Error(error.message);
      imageUrl = data?.image_url || null;
      title = data?.title || title;
    }
    if (looksLikePeoplePrimaryText(title, slug)) {
      console.warn(`[podcasts] Skipping people-primary article hero: ${title}`);
      continue;
    }
    if (!isUsableArticleImage(imageUrl)) continue;
    try {
      const downloaded = await fetchImageBuffer(imageUrl, fetchImpl);
      const imageOrigin = articleImageOrigin(imageUrl) || 'generated';
      return {
        source: 'florida_buzz_article',
        imageOrigin,
        useAsIs: imageOrigin === 'generated',
        subjectKind: 'place',
        query: label,
        title,
        pageUrl: row.source.url || null,
        imageUrl: stripTracking(imageUrl),
        credit: `Florida Buzz article ${imageOrigin} photo (${slug || title})`,
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
      };
    } catch (err) {
      console.warn(`[podcasts] Article hero reference failed (${slug}): ${err.message}`);
    }
  }
  return null;
}

async function findPlaceReferencePhoto({
  label = '',
  category = '',
  prompt = '',
  direction = '',
  episodeId = null,
  store = null,
  supabase = null,
  fetchImpl = fetch,
} = {}) {
  const directionPlace = extractPlaceFromDirection(direction);
  // Article heroes first (skip when admin directs a different place).
  // People-panel heroes are filtered inside findArticleHeroReference.
  if (!directionPlace) {
    const articleRef = await findArticleHeroReference({
      label,
      episodeId,
      store,
      supabase,
      fetchImpl,
    }).catch((err) => {
      console.warn(`[podcasts] Article reference lookup failed: ${err.message}`);
      return null;
    });
    if (articleRef) return articleRef;
  }

  const query = buildPlaceSearchQuery({ label, category, prompt, direction });
  const tried = new Set();
  const trySearch = async (q) => {
    const cleaned = String(q || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 4 || tried.has(cleaned.toLowerCase())) return null;
    tried.add(cleaned.toLowerCase());
    return searchWikimediaPlacePhoto(cleaned, { fetchImpl }).catch((err) => {
      console.warn(`[podcasts] Wikimedia place search failed (${cleaned.slice(0, 60)}): ${err.message}`);
      return null;
    });
  };

  let wiki = await trySearch(query);
  if (wiki) return { ...wiki, subjectKind: 'place', imageOrigin: 'sourced', useAsIs: false };

  for (const fallback of placeSearchFallbacks({ label, prompt, direction, primaryQuery: query })) {
    wiki = await trySearch(fallback);
    if (wiki) return { ...wiki, subjectKind: 'place', imageOrigin: 'sourced', useAsIs: false };
  }

  const curated = await curatedWikimediaFallback(
    `${direction} ${directionPlace} ${label} ${prompt} ${query}`,
    fetchImpl
  ).catch(() => null);
  if (curated) return { ...curated, subjectKind: 'place', imageOrigin: 'sourced', useAsIs: false };

  return null;
}

function withReferencePrompt(prompt, reference) {
  const body = String(prompt || '').trim();
  if (!reference?.buffer) return body;
  const lock =
    'Reference photograph lock: A real photograph of this PLACE is attached as the layout template. ' +
    'Preserve the real architecture, skyline relationships, and the SAME primary subject from that photo exactly — keep the subject tight in frame. ' +
    'Create a PHOTOREALISTIC travel photograph (real camera look), NATURAL white balance daylight — NO yellow/amber/sepia wash, NOT illustration or concept art. ' +
    'Do not invent ticket gates, buildings, roads, or landmarks that are not in the reference. ' +
    'Do not make unknown people or panel guests the primary subject.';
  if (body.includes('Reference photograph lock:')) return body;
  return `${body}\n\n${lock}`;
}

function referenceReviewQuestion({ label = '', category = '', reference = null } = {}) {
  const base =
    `Podcast story title: ${String(label).slice(0, 180)}\n` +
    `Category: ${String(category || '').slice(0, 80)}\n`;
  if (!reference) {
    return (
      `${base}` +
      'FAIL this still — podcast YouTube stills require a real place-photo template. ' +
      'Is this still somehow an accurate single-place Walt Disney World view with no yellow cast and no people-primary subject?'
    );
  }
  if (reference.useAsIs) {
    return (
      `${base}` +
      `Florida Buzz AI article hero used as-is (${String(reference.title || '').slice(0, 120)}).\n` +
      'Does this still (1) show the story place/product, (2) avoid yellow/sepia grading, and (3) keep place/product as subject not random people?'
    );
  }
  return (
    `${base}` +
    `A real place reference photo was used (${reference.source}: ${String(reference.title || '').slice(0, 120)}).\n` +
    'Does this still (1) keep that real place layout and tight primary subject, (2) avoid yellow/sepia grading, (3) keep the place/product as subject not random people, ' +
    'and (4) look photorealistic (photograph-like, not illustration)?'
  );
}

module.exports = {
  USER_AGENT,
  buildPlaceSearchQuery,
  creditFromMeta,
  extractPlaceFromDirection,
  fetchImageBuffer,
  fetchWikimediaFileByTitle,
  findArticleHeroReference,
  findPlaceReferencePhoto,
  licenseLooksOk,
  looksLikePeoplePrimaryText,
  overlapScore,
  placeSearchFallbacks,
  referenceReviewQuestion,
  searchWikimediaPlacePhoto,
  stripTracking,
  withReferencePrompt,
};
