'use strict';

const { EDITORIAL_PHOTO_STYLE, withEditorialPhotoStyle } = require('../editorialPhotoStyle');

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

  return withEditorialPhotoStyle(scene);
}

module.exports = {
  EDITORIAL_PHOTO_STYLE,
  broadenVisualPrompt,
  storySubject,
  withEditorialPhotoStyle,
};
