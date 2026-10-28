'use strict';

/**
 * Site article photos: cinematic photoreal editorial travel photography.
 * Keep this strict — article images sit next to real photos on the site.
 */
const EDITORIAL_PHOTO_STYLE = `Create a cinematic, photorealistic editorial travel photograph for a Florida theme-park news story.
The image should look like a premium travel-magazine photograph—not a painting, cartoon, poster, collage, or obvious AI illustration. Use realistic architecture, natural human proportions, authentic materials, crisp environmental detail, and believable Florida lighting.

Composition: immersive eye-level perspective, strong foreground subject, recognizable story-relevant environment in the background, natural depth of field, and a balanced 16:9 horizontal composition suitable for a news article or YouTube video.

Lighting and color: bright natural Florida daylight with NATURAL white balance, realistic shadows, rich but believable colors, sharp focus, and polished cinematic contrast. Keep sunlight and contrast, but avoid heavy yellow/amber/orange golden-hour grading washes. Whites should read clean (not cream), skies can hold true blue, foliage true green, and skin tones natural — not a muddy yellow cast.

People may appear naturally as park visitors in the background, but no person should be the primary identifiable subject unless the story requires it. Prefer a wide establishing photograph of the actual location without prominent foreground people when possible. Small background crowds are acceptable only if they look natural. If people appear, heads, faces, hands, arms and legs must be anatomically correct; heads must face naturally relative to torsos and bodies must be oriented correctly. People must interact realistically with objects. Adults must push strollers from behind, not pull them from the front; children must be seated naturally. Stroller handles, wheels, seats and frames must have correct geometry. No duplicated, merged, floating, malformed or partially generated people, including distorted people in background crowds.

The visual must directly represent the story being discussed. Show only one real place — never a mashup of multiple lands, attractions, or invented architecture. Do not add unrelated attractions, landmarks, aircraft, fireworks, characters, or scenery merely for decoration. Retain the actual subject and location; prefer a modest, accurate photographic view of the existing setting when details are uncertain. Do not invent announced designs or present rumors as completed attractions.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text. Match the photographic appearance of genuine photographs beside it on Florida Buzz.`;

/**
 * Legacy Mandalorian-episode illustration brief (kept for historical tests / reference).
 * New YouTube stills use PODCAST_YOUTUBE_PHOTOREAL_STYLE instead.
 */
const PODCAST_YOUTUBE_ILLUSTRATION_STYLE = `Create a densely detailed cinematic digital travel illustration for a Florida theme-park news podcast YouTube still.
Match the FIRST Florida Buzz YouTube episode / Mandalorian Galaxy's Edge still: ultra-sharp micro-detail (weathered materials, fabric weave, stone grain, pipes, lantern metalwork, individual paving stones), crowded layered depth, immersive eye-level composition, polished high-end concept-art fidelity — cool silver-grey materials, crisp modern cinematic look. NOT soft blurry painterly wash, NOT vintage sepia, NOT muddy golden-hour postcard, NOT flat stock photo, NOT cartoon, NOT collage, NOT multi-land mashup.

Composition: strong story-relevant place filling the frame, natural depth of field, balanced 16:9. The PLACE or product is the subject — not random people, panelists, or interview guests.

Lighting and color (CRITICAL): bright directional Florida daylight with NATURAL white balance. FORBIDDEN: yellow/amber/orange golden-hour washes, sepia, cream whites, warm vintage grading. Metal reads cool silver-grey; skin tones natural; sky true blue; foliage true green; building colors accurate. High micro-contrast and crisp edges like the Mandalorian episode still.

A real reference photograph of the place MUST be the layout template. Preserve that photo's real architecture and spatial relationships. Do not invent buildings, ticket gates, roads, or landmarks that are not in the reference.

Hard Disney World geography:
- Magic Kingdom ticket/tapstile machines sit at the park ENTRANCE before guests walk under the railroad bridge — never place those machines on Main Street with Cinderella Castle behind them.
- BoardWalk: pedestrian wood promenade only; no cars/buses/asphalt in front of BoardWalk buildings.
- runDisney: runners on park paths/plazas/race courses — not car lanes beside buses.
- Contemporary Resort: monorail THROUGH the A-frame, not only around the outside.
- Never mash landmarks from different parks into one invented view.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text. No portraits of unknown speakers or D23 panel guests as the hero subject.`;

/**
 * Active YouTube still style when restyling a sourced / Wikimedia place photo.
 * Photorealistic, tight subject lock to the reference — not Mandalorian illustration.
 */
const PODCAST_YOUTUBE_PHOTOREAL_STYLE = `Create a photorealistic editorial travel photograph for a Florida theme-park news podcast YouTube still.
It must look like a real camera photograph — not a painting, cartoon, poster, collage, concept-art illustration, or obvious AI stylization. Match premium travel-magazine photography: realistic architecture, authentic materials, natural Florida daylight, crisp detail.

Tight subject lock (CRITICAL): keep the SAME primary subject from the attached reference photograph as the hero of the frame. Do not widen into an unrelated panorama, swap landmarks, or invent a different attraction. Crop/reframe only enough for a clean 16:9 YouTube still while preserving that subject.

Composition: immersive eye-level view, strong foreground subject, balanced 16:9, natural depth of field. The PLACE or product is the subject — not random people, panelists, or interview guests.

Lighting and color: bright natural Florida daylight with NATURAL white balance. FORBIDDEN: yellow/amber/orange golden-hour washes, sepia, cream whites, warm vintage grading. Whites clean; sky true blue; foliage true green; skin tones natural.

A real reference photograph is attached as the layout template. Preserve that photo's real architecture and spatial relationships. Do not invent buildings, ticket gates, roads, or landmarks that are not in the reference.

Hard Disney World geography:
- Magic Kingdom ticket/tapstile machines sit at the park ENTRANCE before guests walk under the railroad bridge — never place those machines on Main Street with Cinderella Castle behind them.
- BoardWalk: pedestrian wood promenade only; no cars/buses/asphalt in front of BoardWalk buildings.
- runDisney: runners on park paths/plazas/race courses — not car lanes beside buses.
- Contemporary Resort: monorail THROUGH the A-frame, not only around the outside.
- Never mash landmarks from different parks into one invented view.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text. No portraits of unknown speakers or D23 panel guests as the hero subject.`;

function applyStyleBlock(prompt, styleBlock) {
  const body = String(prompt || '').trim();
  const style = String(styleBlock || '').trim();
  if (!body) return style;
  if (!style) return body;
  const marker = style.slice(0, 48);
  if (marker && body.includes(marker)) return body;
  return `${body}\n\n${style}`;
}

function withEditorialPhotoStyle(prompt) {
  return applyStyleBlock(prompt, EDITORIAL_PHOTO_STYLE);
}

function withPodcastYoutubeStyle(prompt) {
  return applyStyleBlock(prompt, PODCAST_YOUTUBE_PHOTOREAL_STYLE);
}

module.exports = {
  EDITORIAL_PHOTO_STYLE,
  PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
  PODCAST_YOUTUBE_PHOTOREAL_STYLE,
  applyStyleBlock,
  withEditorialPhotoStyle,
  withPodcastYoutubeStyle,
};
