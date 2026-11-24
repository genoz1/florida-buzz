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
  /\bRemy'?s?\s+Ratatouille\s+Adventure\b/i,
  /\bRatatouille\b/i,
  /\bFrance\s+Pavilion\b/i,
  /\bBlizzard\s+Beach\b/i,
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

/**
 * Specific story subjects that must NOT collapse into generic Magic Kingdom /
 * Main Street / castle / Spaceship Earth stock photos.
 */
const SPECIFIC_SUBJECT_RE =
  /\b(gingerbread(?:\s+\w+){0,3}|spirit\s+jersey(?:es)?|holiday\s+sweater|merchandise\s+display|retail\s+display|dessert\s+display|food\s+display|popcorn\s+bucket|sipper|ear\s+headband|mickey\s+ears|plush|ornament|treat|cupcake|cookie|bakery|concession|snack|menu\s+item|limited[- ]edition|souvenir|gift\s+shop\s+display|remy'?s?|ratatouille|france\s+pavilion|dining\s*plan|ticket\s+projection|premier\s+pass|blizzard\s+beach|ride\s+props?)\b/i;

const GENERIC_LANDMARK_RE =
  /\b(main street|cinderella castle|railroad|train station|spaceship earth|magic kingdom entrance|park exterior|tomorrowland)\b/i;

/** Wrong park-icon pairs: story subject → landmarks that must never stand in for it. */
const SUBJECT_ICON_BANS = [
  {
    subject: /\b(remy|ratatouille|france\s+pavilion|ride\s+props?)\b/i,
    bad: /\b(spaceship\s+earth|cinderella\s+castle|main\s+street|train\s+station|railroad)\b/i,
  },
  {
    subject: /\bdining\s*plan\b/i,
    bad: /\b(main\s+street|train\s+station|railroad|cinderella\s+castle|spaceship\s+earth)\b/i,
  },
  {
    subject: /\b(ticket|tickets|ticket\s+projection|premier\s+pass|ticketing)\b/i,
    bad: /\b(cinderella\s+castle|spaceship\s+earth|ratatouille|remy)\b/i,
  },
  {
    subject: /\bblizzard\s+beach\b/i,
    bad: /\b(cinderella\s+castle|spaceship\s+earth|main\s+street|train\s+station)\b/i,
  },
];

function cleanSubjectPhrase(text = '') {
  return String(text || '')
    .replace(/^(change\s+to|use|show|make\s+it|redo\s+as|create\s+a|follow\s+this\s+direction\s+exactly:?)\s+/i, '')
    .replace(/\b(photo\s*realistic|photorealistic|neutrally\s+graded|cinematic|illustration|image|picture|real\s+photo\s+of)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull a product/attraction/offer subject that should beat generic park landmarks. */
function extractSpecificSubject(...parts) {
  const text = parts.map((part) => String(part || '')).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Named attractions / offers first (Remy, dining plan, tickets, etc.).
  if (/\b(remy'?s?|ratatouille)\b/i.test(text)) {
    return "Remy's Ratatouille Adventure France pavilion queue ride props";
  }
  if (/\bdining\s*plan\b/i.test(text)) {
    return 'Disney Dining Plan restaurant table-service meal offer';
  }
  if (/\b(ticket\s+projection|ticket\s+prices?|premier\s+pass)\b/i.test(text)) {
    return 'Walt Disney World ticket entrance gates turnstiles';
  }
  if (/\bblizzard\s+beach\b/i.test(text)) {
    return 'Blizzard Beach water park Mount Gushmore';
  }

  const match = text.match(
    /\b((?:gingerbread(?:\s+\w+){0,4})|(?:holiday\s+)?spirit\s+jersey(?:es)?|(?:merchandise|retail|dessert|food|holiday)\s+display(?:\s+of\s+[\w\s-]{2,40})?|(?:popcorn\s+bucket|sipper|ear\s+headband|mickey\s+ears|plush|ornament|cupcake|cookie)(?:\s+[\w-]{2,20}){0,3}|france\s+pavilion|ride\s+props?)\b/i
  );
  if (match) return cleanSubjectPhrase(match[0]).slice(0, 120);

  // Label-style titles: "Gingerbread Giraffe Returns" / "Remy Ride Props Updated".
  const labelish = cleanSubjectPhrase(text)
    .replace(/\b(returns?|arrives?|debuts?|back|again|new|updated|refreshed|changes?|offer)\b/gi, ' ')
    .replace(/\$\d+(?:\.\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SPECIFIC_SUBJECT_RE.test(labelish) || SPECIFIC_SUBJECT_RE.test(text)) {
    return (labelish || cleanSubjectPhrase(text)).slice(0, 120);
  }
  return '';
}

function hasSpecificSubject(...parts) {
  return Boolean(extractSpecificSubject(...parts));
}

/** Pull a concrete place/subject override out of admin reject/redo direction text. */
function extractPlaceFromDirection(direction = '') {
  const text = String(direction || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Specific merchandise / display subjects win over park-name collapse.
  const specific = extractSpecificSubject(text);
  if (specific) return specific;

  const hints = [];
  for (const re of PLACE_NAME_PATTERNS) {
    const match = text.match(re);
    if (match) hints.push(match[0]);
  }
  if (hints.length) return [...new Set(hints)].join(' ').slice(0, 120);

  const cleaned = cleanSubjectPhrase(text);
  // Generic park wording ONLY when the direction has no concrete subject left.
  const genericParkDirection =
    /\b(from\s+)?inside\b.{0,40}\bdisney parks?\b|\bdisney parks?\b.{0,40}\binside\b/i.test(text)
    || /^(from\s+)?(inside\s+)?(one\s+of\s+the\s+)?disney parks?\b/i.test(cleaned)
    || /^(walt\s+disney\s+world|disney\s+world)(\s+resort)?(\s+location)?$/i.test(cleaned);
  const hasConcreteSubject = cleaned.length >= 4
    && !genericParkDirection
    && !/^(photo\s*realistic|cinematic|illustration)\b/i.test(cleaned);
  if (!cleaned || (genericParkDirection && !SPECIFIC_SUBJECT_RE.test(text))) {
    return 'Walt Disney World Magic Kingdom Tomorrowland';
  }
  // Keep free-text subjects ("gingerbread giraffe display at its actual … location")
  // instead of collapsing any WDW mention into "park exterior".
  if (hasConcreteSubject) return cleaned.slice(0, 120);
  if (/\bdisney parks?\b|\bwalt disney world\b/i.test(text)) {
    return 'Walt Disney World park exterior';
  }
  return cleaned.length >= 4 ? cleaned.slice(0, 120) : '';
}

function buildPlaceSearchQuery({ label = '', category = '', prompt = '', direction = '' } = {}) {
  const specific = extractSpecificSubject(direction, label, prompt, category);
  const directionPlace = extractPlaceFromDirection(direction);
  const raw = `${direction} ${directionPlace} ${label} ${prompt} ${category}`.replace(/\s+/g, ' ').trim();
  const placeHints = [];
  for (const re of PLACE_NAME_PATTERNS) {
    const match = raw.match(re);
    if (match) placeHints.push(match[0]);
  }
  // Admin direction / specific product subject wins — skip remaps that fight it.
  if (directionPlace) {
    placeHints.unshift(directionPlace);
  }
  if (specific) {
    placeHints.unshift(specific);
  }
  const directionOverridesPlace = Boolean(directionPlace || specific);
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
    placeHints.unshift('World of Disney Disney Springs spirit jersey display');
  }
  // Bag / security / prohibited items stories → Main Street / park entrance (not abstract "restrictions").
  if (
    !directionOverridesPlace
    && /\b(bag|bags|backpack|security|prohibited|restricted items?|park bag)\b/i.test(raw)
    && !/\bmain street|entrance|railroad|magic kingdom\b/i.test(placeHints.join(' '))
  ) {
    placeHints.unshift('Magic Kingdom Main Street USA entrance');
  }
  const labelCore = directionOverridesPlace && specific
    ? specific
    : directionOverridesPlace
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

/**
 * Reject stock/article photos that are clearly the wrong subject
 * (Spaceship Earth for Remy; Main Street station for Dining Plan; etc.).
 */
function referenceMatchesSubject(reference, { label = '', prompt = '', direction = '', category = '' } = {}) {
  if (!reference) return false;
  const storyText = `${direction} ${label} ${prompt} ${category}`;
  const specific = extractSpecificSubject(direction, label, prompt, category);
  const hay = [
    reference.title,
    reference.query,
    reference.credit,
    reference.pageUrl,
    reference.imageUrl,
    reference.slug,
  ].map((part) => String(part || '')).join(' ');
  const hayNorm = normalizeMatchText(hay);

  // Hard bans: never let a park icon stand in for these subjects.
  for (const rule of SUBJECT_ICON_BANS) {
    if (rule.subject.test(storyText) && rule.bad.test(hay)) {
      return false;
    }
  }

  if (!specific) return true;

  const score = overlapScore(specific, hay);
  if (score >= 0.2) return true;
  // Specific product/attraction/offer stories must not accept generic landmark stock.
  if (GENERIC_LANDMARK_RE.test(hay) && !SPECIFIC_SUBJECT_RE.test(hay)) {
    return false;
  }
  // Require at least one distinctive token from the specific subject.
  const tokens = normalizeMatchText(specific).split(' ').filter((w) => (
    w.length > 3
    && !/^(disney|world|walt|resort|display|photo|image|real|offer|plan|queue|props|ride|adventure|pavilion|france|entrance|gates|turnstiles)$/.test(w)
  ));
  if (!tokens.length) return score >= 0.15;
  return tokens.some((token) => hayNorm.includes(token));
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
  const specific = extractSpecificSubject(direction, label, prompt);
  const directionPlace = extractPlaceFromDirection(direction);
  const hay = `${direction} ${directionPlace} ${label} ${prompt} ${primaryQuery}`;
  const out = [];
  const push = (q) => {
    const cleaned = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (cleaned.length >= 4 && !out.includes(cleaned)) out.push(cleaned);
  };
  if (specific) {
    push(`${specific} Walt Disney World`);
    if (/\bremy|ratatouille|france\b/i.test(specific)) {
      push("Remy's Ratatouille Adventure EPCOT France pavilion");
      push('Ratatouille France pavilion World Showcase');
    } else if (/\bdining\s*plan\b/i.test(specific)) {
      push('Disney restaurant table service dining room Walt Disney World');
      push('EPCOT World Showcase dining restaurant');
    } else if (/\bticket|turnstile|entrance gates\b/i.test(specific)) {
      push('Magic Kingdom entrance ticket gates turnstiles');
    } else {
      push(`${specific} Disney Springs`);
      push(`${specific} holiday display`);
    }
    push(specific);
  }
  if (directionPlace && directionPlace !== specific) {
    push(`${directionPlace} Walt Disney World`);
    push(directionPlace);
  }
  // Generic landmark fallbacks only when the story is actually about those places —
  // never when a specific merchandise/display subject is present.
  if (!specific && /\bmain street\b/i.test(hay)) {
    push('Main Street USA Magic Kingdom');
    push('Magic Kingdom Main Street Walt Disney World');
  }
  if (!specific && /\b(bag|bags|backpack|security|prohibited|restricted items?|park bag)\b/i.test(hay)) {
    push('Magic Kingdom Main Street USA');
    push('Magic Kingdom entrance railroad station');
  }
  if (!directionPlace && !specific && label) {
    push(`${label} Walt Disney World`);
  }
  if (!specific) {
    // Last resort so thin labels still get a real WDW place photo.
    push('Magic Kingdom Main Street Walt Disney World');
    push('Cinderella Castle Magic Kingdom Walt Disney World');
  }
  return out.filter((q) => q !== String(primaryQuery || '').trim());
}

async function curatedWikimediaFallback(hay, fetchImpl, { label = '', prompt = '', direction = '' } = {}) {
  const text = String(hay || '');
  const specific = extractSpecificSubject(direction, label, prompt, text);
  // Never force Main Street / castle curated files onto product/display stories.
  if (specific) return null;
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
  const subjectCtx = { label, category, prompt, direction };
  const directionPlace = extractPlaceFromDirection(direction);
  const specific = extractSpecificSubject(direction, label, prompt, category);
  const accept = (ref) => {
    if (!ref) return null;
    if (!referenceMatchesSubject(ref, subjectCtx)) {
      console.warn(
        `[podcasts] Skipping mismatched place reference for "${specific || label}": ${ref.title || ref.imageUrl}`
      );
      return null;
    }
    return { ...ref, subjectKind: 'place', imageOrigin: ref.imageOrigin || 'sourced', useAsIs: Boolean(ref.useAsIs) };
  };

  // Article heroes first (skip when admin directs a different place/subject).
  // People-panel heroes are filtered inside findArticleHeroReference.
  if (!directionPlace && !specific) {
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
    const acceptedArticle = accept(articleRef);
    if (acceptedArticle) return acceptedArticle;
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

  let wiki = accept(await trySearch(query));
  if (wiki) return wiki;

  for (const fallback of placeSearchFallbacks({ label, prompt, direction, primaryQuery: query })) {
    wiki = accept(await trySearch(fallback));
    if (wiki) return wiki;
  }

  const curated = accept(
    await curatedWikimediaFallback(
      `${direction} ${directionPlace} ${label} ${prompt} ${query}`,
      fetchImpl,
      { label, prompt, direction }
    ).catch(() => null)
  );
  if (curated) return curated;

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
  extractSpecificSubject,
  fetchImageBuffer,
  fetchWikimediaFileByTitle,
  findArticleHeroReference,
  findPlaceReferencePhoto,
  hasSpecificSubject,
  licenseLooksOk,
  looksLikePeoplePrimaryText,
  overlapScore,
  placeSearchFallbacks,
  referenceMatchesSubject,
  referenceReviewQuestion,
  searchWikimediaPlacePhoto,
  stripTracking,
  withReferencePrompt,
};
