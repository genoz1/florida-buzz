'use strict';

const {
  PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
  PODCAST_YOUTUBE_PHOTOREAL_STYLE,
  withPodcastYoutubeStyle,
} = require('../editorialPhotoStyle');

/**
 * When a very specific podcast still fails review (guest-room interior, ride cabin,
 * etc.), broaden to a clearly related exterior of the SAME story subject.
 * Never drift to a generic Magic Kingdom castle, random park icon, or cover art.
 */
function storySubject(label = '', category = '') {
  const subject = String(label || category || '')
    .replace(/\s+/g, ' ')
    .replace(/^(refreshed|updated|new|the)\s+/i, '')
    .replace(/\s+rooms?\s*$/i, '')
    .trim();
  return subject || 'this Disney World story location';
}

/** Extra place locks appended when the story clearly names a known inaccurate trap. */
function placeAccuracyRules(text = '') {
  const t = String(text || '').toLowerCase();
  const rules = [];

  if (/\bboard\s*-?\s*walk\b/.test(t)) {
    rules.push(
      "Disney's BoardWalk is a wooden pedestrian boardwalk and lakeside promenade — show people walking on wood planks by the water. " +
        'No cars, buses, asphalt roads, parking, or vehicle traffic in front of the BoardWalk Inn / BoardWalk buildings.'
    );
  }

  if (/\b(rundisney|run disney|wine\s*&\s*dine|wine and dine|road closure|race weekend|5k|10k|half marathon|marathon)\b/.test(t)) {
    rules.push(
      'runDisney athletes run on park paths, plaza pavement, or a marked race course through Walt Disney World parks and resort walking areas. ' +
        'Do not show runners in automotive traffic lanes, beside transit buses, or on ordinary car roads.'
    );
  }

  if (/\bcontemporary\b/.test(t) || /\bmonorail\b/.test(t)) {
    rules.push(
      "At Disney's Contemporary Resort, the monorail beamway passes THROUGH the A-frame hotel building (the iconic through-the-building view). " +
        'Do not draw the monorail only circling outside around the hotel.'
    );
  }

  if (/\b(magic kingdom|cinderella|main street|premier pass|lightning lane|turnstile|ticket)\b/.test(t)) {
    rules.push(
      'Keep Magic Kingdom geography honest: entrance plaza / turnstiles, Main Street, and Cinderella Castle are separate spaces — ' +
        'do not glue the train station facade and castle into one invented continuous plaza.'
    );
  }

  if (/\bbell services?\b|\bcold grocery|\bluggage cart|\bbellhop\b/.test(t)) {
    rules.push(
      'Bell services / luggage: show luggage carts and bags at a real resort arrival area. ' +
        'If the Contemporary appears, keep the monorail through the A-frame, not wrapped around the exterior only.'
    );
  }

  return rules;
}

function hardenPlacePrompt(prompt, { label = '', category = '' } = {}) {
  const body = String(prompt || '').trim();
  const rules = placeAccuracyRules(`${body} ${label} ${category}`);
  if (!rules.length) return body;
  const block = `Place accuracy locks:\n- ${rules.join('\n- ')}`;
  if (body.includes('Place accuracy locks:')) return body;
  return `${body}\n\n${block}`.trim();
}

function broadenVisualPrompt(prompt, { label = '', category = '', level = 1, rejection = '' } = {}) {
  const subject = storySubject(label, category);
  const evidence = `${prompt} ${label} ${category} ${rejection}`.toLowerCase();
  const wantsInterior =
    /\b(room|rooms|suite|interior|inside|indoors?|guest room|furnishings|bathroom|décor|decor|lobby desk|queue interior|ride vehicle|onboard|cabin)\b/.test(
      evidence
    );
  const wantsHotel =
    /\b(hotel|resort|inn|lodge|villa|suite|room|rooms|boardwalk|contemporary|polynesian|grand floridian|caribbean|riviera|wilderness|beach club|yacht club|art of animation|pop century|all-star)\b/.test(
      evidence
    );
  const wantsAttraction =
    /\b(ride|coaster|attraction|mountain|rail|ship|boat|theater|theatre|show)\b/.test(evidence) ||
    /\b(space mountain|haunted mansion|pirates|everest|test track|guardians)\b/.test(evidence);

  const banGeneric =
    'Do not show Cinderella Castle, Magic Kingdom castle, Spaceship Earth, or any unrelated park icon. ' +
    `The image must clearly depict ${subject} (or its real exterior), not a generic Disney World postcard. ` +
    'Show only that one real place — never a mashup of multiple lands, attractions, or invented architecture.';

  let scene;
  if (level <= 1) {
    if (wantsInterior && wantsHotel) {
      scene =
        `Foreground: the recognizable exterior facade and entrance of the ${subject} hotel or resort at Walt Disney World. ` +
        `Background: Florida sky, landscaping, and optional distant guests. ${banGeneric}`;
    } else if (wantsInterior || wantsAttraction) {
      scene =
        `Foreground: the outside of ${subject} at Walt Disney World (queue entrance, show building, or landmark exterior — not a ride-vehicle interior). ` +
        `Background: the same attraction's real surroundings only. ${banGeneric}`;
    } else {
      scene =
        `Foreground: a clear view of ${subject} at Walt Disney World Resort. ` +
        `Background: only that place's real environment. ${banGeneric}`;
    }
  } else if (wantsHotel) {
    scene =
      `Simple wide exterior establishing view of the ${subject} resort hotel facade and entrance area ` +
      `at Walt Disney World. No interiors. ${banGeneric}`;
  } else {
    scene =
      `Simple wide exterior establishing view of ${subject} at Walt Disney World, ` +
      `clearly the same place from the story. No interiors. ${banGeneric}`;
  }

  return withPodcastYoutubeStyle(hardenPlacePrompt(scene, { label, category }));
}

/** Stricter visual review for podcast YouTube stills (place honesty matters on-screen). */
const PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS = `Review this Florida Buzz podcast YouTube still (photorealistic AI restyle of a real place photo, Florida Buzz article hero used as-is, or the real place photo itself).
PASS only when ALL are true:
1) Subject is the story PLACE or product (architecture, attraction, merchandise display) — NOT a portrait/panel of unknown people as the hero.
2) Geography matches a real Walt Disney World view — no invented mashups.
3) Looks photorealistic (real photograph or photograph-like), with natural daylight and cool/neutral whites — NOT yellow/amber/sepia vintage wash, NOT cartoon/illustration stylization.
4) When a reference photo was used, layout and primary subject follow that photo tightly (no invented ticket gates, buildings, or landmarks; no subject swap).
Hard rejects:
- Magic Kingdom ticket/tapstile machines on Main Street with Cinderella Castle behind them (gates are at the entrance before the railroad bridge)
- BoardWalk with cars/buses/asphalt in front of the buildings
- runDisney runners in car lanes beside buses
- Contemporary monorail only around the hotel instead of through the A-frame
- Spaceship Earth mashed into Magic Kingdom / Contemporary views
- Yellow/golden-hour/sepia cast over the whole frame
- Talk-show / D23 panel guests / two random people as the primary subject when the story is about a place or product
- Blank title cards, empty scenes, or no credible story connection
List only high-confidence visible defects. On acceptance return no issues and an empty correction.`;

module.exports = {
  PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
  PODCAST_YOUTUBE_PHOTOREAL_STYLE,
  PODCAST_YOUTUBE_REVIEW_INSTRUCTIONS,
  broadenVisualPrompt,
  hardenPlacePrompt,
  placeAccuracyRules,
  storySubject,
  withPodcastYoutubeStyle,
};
