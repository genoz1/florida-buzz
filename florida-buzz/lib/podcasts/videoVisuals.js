'use strict';

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
    `The image must clearly depict ${subject} (or its real exterior), not a generic Disney World postcard.`;

  if (level <= 1) {
    if (wantsInterior && wantsHotel) {
      return (
        `Wide daytime exterior photograph of the ${subject} hotel or resort building at Walt Disney World, ` +
        `showing that specific property from outside, photorealistic Florida travel editorial, ` +
        `guests optional in the distance, no readable text or logos. ${banGeneric}`
      );
    }
    if (wantsInterior || wantsAttraction) {
      return (
        `Wide daytime exterior photograph of ${subject} at Walt Disney World, showing the outside of that ` +
        `same attraction or landmark, photorealistic travel editorial, no ride-vehicle interiors, ` +
        `no readable text or logos. ${banGeneric}`
      );
    }
    return (
      `Wide daytime exterior photograph focused on ${subject} at Walt Disney World Resort, ` +
      `photorealistic Florida travel editorial, no close-up interiors, no readable text or logos. ${banGeneric}`
    );
  }

  // Level 2: still the same subject, just a simpler recognizable exterior angle.
  if (wantsHotel) {
    return (
      `Simple wide exterior establishing photograph of the ${subject} resort hotel facade and entrance area ` +
      `at Walt Disney World in daytime, photorealistic, no interiors, no readable text or logos. ${banGeneric}`
    );
  }
  return (
    `Simple wide exterior establishing photograph of ${subject} at Walt Disney World in daytime, ` +
    `photorealistic, clearly the same place from the story, no interiors, no readable text or logos. ${banGeneric}`
  );
}

module.exports = { broadenVisualPrompt, storySubject };
