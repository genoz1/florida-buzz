'use strict';

/**
 * When a very specific podcast still fails review (guest-room interior, ride cabin,
 * etc.), broaden to a clearly related exterior/establishing view instead of aborting.
 */
function broadenVisualPrompt(prompt, { label = '', category = '', level = 1, rejection = '' } = {}) {
  const subject = String(label || category || 'Walt Disney World').replace(/\s+/g, ' ').trim();
  const evidence = `${prompt} ${label} ${category} ${rejection}`.toLowerCase();
  const wantsInterior =
    /\b(room|rooms|suite|interior|inside|indoors?|guest room|furnishings|bathroom|décor|decor|lobby desk|queue interior|ride vehicle|onboard|cabin)\b/.test(
      evidence
    );
  const wantsAttraction =
    /\b(ride|coaster|attraction|mountain|rail|ship|boat|theater|theatre|show)\b/.test(evidence) ||
    /\b(space mountain|haunted mansion|pirates|everest|test track|guardians)\b/.test(evidence);

  if (level <= 1) {
    if (wantsInterior && !wantsAttraction) {
      return (
        `Wide daytime exterior establishing photograph of the ${subject} hotel or resort building ` +
        `at Walt Disney World, photorealistic Florida travel editorial, guests optional in the distance, ` +
        `no readable text, logos, or invented signage`
      );
    }
    if (wantsInterior || wantsAttraction) {
      return (
        `Wide exterior establishing photograph of ${subject} at Walt Disney World, showing the outside of the ` +
        `attraction or landmark in daytime, photorealistic travel editorial, no ride-vehicle interiors, ` +
        `no readable text, logos, or invented signage`
      );
    }
    return (
      `Wide exterior establishing photograph related to ${subject} at Walt Disney World Resort, ` +
      `daytime Florida light, photorealistic travel editorial, no close-up interiors, no readable text or logos`
    );
  }

  return (
    `Wide daytime establishing photograph of a recognizable Walt Disney World park or resort exterior ` +
    `related to ${subject}, photorealistic Florida travel editorial, no interiors, no readable text, logos, ` +
    `or fictional details`
  );
}

module.exports = { broadenVisualPrompt };
