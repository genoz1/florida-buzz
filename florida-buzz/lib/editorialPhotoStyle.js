'use strict';

/**
 * Standard visual direction for Florida Buzz AI photos (site articles + podcast YouTube stills).
 * Tuned from the ChatGPT work prompts that produced the first podcast YouTube episode look:
 * cinematic photoreal editorial travel photography with bright Florida light — not a short
 * “16:9 editorial travel photograph” stub that leaves composition to chance.
 */
const EDITORIAL_PHOTO_STYLE = `Create a cinematic, photorealistic editorial travel photograph for a Florida theme-park news story.
The image should look like a premium travel-magazine photograph—not a painting, cartoon, poster, collage, or obvious AI illustration. Use realistic architecture, natural human proportions, authentic materials, crisp environmental detail, and believable Florida lighting.

Composition: immersive eye-level perspective, strong foreground subject, recognizable story-relevant environment in the background, natural depth of field, and a balanced 16:9 horizontal composition suitable for a news article or YouTube video.

Lighting and color: bright natural daylight or warm golden-hour light, realistic shadows, rich but believable colors, sharp focus, and polished cinematic contrast.

People may appear naturally as park visitors in the background, but no person should be the primary identifiable subject unless the story requires it. Prefer a wide establishing photograph of the actual location without prominent foreground people when possible. Small background crowds are acceptable only if they look natural. If people appear, heads, faces, hands, arms and legs must be anatomically correct; heads must face naturally relative to torsos and bodies must be oriented correctly. People must interact realistically with objects. Adults must push strollers from behind, not pull them from the front; children must be seated naturally. Stroller handles, wheels, seats and frames must have correct geometry. No duplicated, merged, floating, malformed or partially generated people, including distorted people in background crowds.

The visual must directly represent the story being discussed. Show only one real place — never a mashup of multiple lands, attractions, or invented architecture. Do not add unrelated attractions, landmarks, aircraft, fireworks, characters, or scenery merely for decoration. Retain the actual subject and location; prefer a modest, accurate photographic view of the existing setting when details are uncertain. Do not invent announced designs or present rumors as completed attractions.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text. Match the photographic appearance of genuine photographs beside it on Florida Buzz.`;

function withEditorialPhotoStyle(prompt) {
  const body = String(prompt || '').trim();
  if (!body) return EDITORIAL_PHOTO_STYLE;
  if (/cinematic,\s*photorealistic editorial travel photograph/i.test(body)) return body;
  return `${body}\n\n${EDITORIAL_PHOTO_STYLE}`;
}

module.exports = {
  EDITORIAL_PHOTO_STYLE,
  withEditorialPhotoStyle,
};
