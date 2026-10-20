'use strict';

/**
 * Find a real, licensed place photograph to anchor YouTube still generation.
 * Prefer Florida Buzz article heroes when the story matches; otherwise Wikimedia Commons.
 * Never invent image URLs — only return photos actually retrieved from these sources.
 */

const { isUsableArticleImage } = require('../articleImages');

const USER_AGENT = 'FloridaBuzzBot/1.0 (podcast place references; https://thefloridabuzz.com)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

const REJECT_TITLE =
  /\b(logo|map|diagram|icon|seal|flag|svg|screenshot|poster|ticket|signage mock|clip art|wordmark|emblem|coat of arms)\b/i;

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

function buildPlaceSearchQuery({ label = '', category = '', prompt = '' } = {}) {
  const raw = `${label} ${prompt} ${category}`.replace(/\s+/g, ' ').trim();
  const placeHints = [];
  const patterns = [
    /\bDisney'?s?\s+Board\s*-?\s*Walk(?:\s+Inn|\s+Villas)?\b/i,
    /\bContemporary(?:\s+Resort)?\b/i,
    /\bMagic Kingdom\b/i,
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
    /\bMain Street(?:\s*,?\s*U\.?S\.?A\.?)?\b/i,
    /\bSpace Mountain\b/i,
    /\bTomorrowland\b/i,
    /\bWorld Showcase\b/i,
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    if (match) placeHints.push(match[0]);
  }
  const labelCore = String(label || '')
    .replace(/\$\d+(?:\.\d+)?/g, ' ')
    .replace(/\b(premier pass|lightning lane|road closures?|wine\s*&\s*dine|rundisney|run disney)\b/gi, ' ')
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
    .map((page) => {
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
    })
    .filter((item) => item.url && /^image\/(jpeg|jpg|png|webp)$/.test(item.mime))
    .filter((item) => titleLooksUseful(item.title))
    .filter((item) => licenseLooksOk(item.extmetadata))
    .filter((item) => item.width >= 800 || item.size >= 80_000)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));

  for (const item of ranked.slice(0, 5)) {
    try {
      const downloaded = await fetchImageBuffer(item.url, fetchImpl);
      return {
        source: 'wikimedia',
        query: q,
        title: item.title,
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        imageUrl: stripTracking(item.url),
        credit: creditFromMeta(item.title, item.extmetadata),
        buffer: downloaded.buffer,
        mimeType: downloaded.mimeType,
      };
    } catch (err) {
      console.warn(`[podcasts] Wikimedia candidate failed (${item.title}): ${err.message}`);
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
    if (!isUsableArticleImage(imageUrl)) continue;
    try {
      const downloaded = await fetchImageBuffer(imageUrl, fetchImpl);
      return {
        source: 'florida_buzz_article',
        query: label,
        title,
        pageUrl: row.source.url || null,
        imageUrl: stripTracking(imageUrl),
        credit: `Florida Buzz article photo (${slug || title})`,
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
  episodeId = null,
  store = null,
  supabase = null,
  fetchImpl = fetch,
} = {}) {
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

  const query = buildPlaceSearchQuery({ label, category, prompt });
  const wiki = await searchWikimediaPlacePhoto(query, { fetchImpl }).catch((err) => {
    console.warn(`[podcasts] Wikimedia place search failed: ${err.message}`);
    return null;
  });
  if (wiki) return wiki;

  // Broader retry with just the label + Disney World.
  if (label && query !== `${label} Walt Disney World`) {
    return searchWikimediaPlacePhoto(`${label} Walt Disney World`.slice(0, 160), { fetchImpl }).catch(() => null);
  }
  return null;
}

function withReferencePrompt(prompt, reference) {
  const body = String(prompt || '').trim();
  if (!reference?.buffer) return body;
  const lock =
    'Reference photograph lock: A real photograph of this place is attached. ' +
    'Preserve the real architecture, skyline relationships, and layout from that photo. ' +
    'Restyle into a richly detailed cinematic digital travel illustration with bright natural Florida daylight (no yellow cast). ' +
    'Do not invent extra buildings, roads, or landmarks that are not supported by the reference. ' +
    'Do not mash in Spaceship Earth, Cinderella Castle, or other parks unless they are clearly in the reference.';
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
      'Is this still an accurate single-place Walt Disney World illustration for this story (no invented mashup geography)?'
    );
  }
  return (
    `${base}` +
    `A real reference photo was used (${reference.source}: ${String(reference.title || '').slice(0, 120)}).\n` +
    'Does this still preserve that real place layout (no invented buildings/roads/landmarks), while matching the story subject?'
  );
}

module.exports = {
  USER_AGENT,
  buildPlaceSearchQuery,
  creditFromMeta,
  fetchImageBuffer,
  findArticleHeroReference,
  findPlaceReferencePhoto,
  licenseLooksOk,
  overlapScore,
  referenceReviewQuestion,
  searchWikimediaPlacePhoto,
  stripTracking,
  withReferencePrompt,
};
