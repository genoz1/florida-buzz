'use strict';

/**
 * Site article photos: cinematic photoreal editorial travel photography.
 * Keep this strict — article images sit next to real photos on the site.
 */
const EDITORIAL_PHOTO_STYLE = `Create a cinematic, photorealistic editorial travel photograph for a Florida theme-park news story.
The image should look like a premium travel-magazine photograph—not a painting, cartoon, poster, collage, or obvious AI illustration. Use realistic architecture, natural human proportions, authentic materials, crisp environmental detail, and believable Florida lighting.

Composition: immersive eye-level perspective, strong foreground subject, recognizable story-relevant environment in the background, natural depth of field, and a balanced 16:9 horizontal composition suitable for a news article or YouTube video.

Lighting and color: bright natural daylight or warm golden-hour light, realistic shadows, rich but believable colors, sharp focus, and polished cinematic contrast.

People may appear naturally as park visitors in the background, but no person should be the primary identifiable subject unless the story requires it. Prefer a wide establishing photograph of the actual location without prominent foreground people when possible. Small background crowds are acceptable only if they look natural. If people appear, heads, faces, hands, arms and legs must be anatomically correct; heads must face naturally relative to torsos and bodies must be oriented correctly. People must interact realistically with objects. Adults must push strollers from behind, not pull them from the front; children must be seated naturally. Stroller handles, wheels, seats and frames must have correct geometry. No duplicated, merged, floating, malformed or partially generated people, including distorted people in background crowds.

The visual must directly represent the story being discussed. Show only one real place — never a mashup of multiple lands, attractions, or invented architecture. Do not add unrelated attractions, landmarks, aircraft, fireworks, characters, or scenery merely for decoration. Retain the actual subject and location; prefer a modest, accurate photographic view of the existing setting when details are uncertain. Do not invent announced designs or present rumors as completed attractions.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text. Match the photographic appearance of genuine photographs beside it on Florida Buzz.`;

/**
 * Podcast YouTube stills: match the first ChatGPT-built episode look (Mandalorian video).
 * That episode looked painterly / richly illustrated even when the written brief said “photoreal.”
 * Prefer warm cinematic digital illustration over sterile corporate photography.
 */
/**
 * Tuned by iterating against the first-episode Galaxy’s Edge still until style matched:
 * dense micro-detail, cool-silver materials, natural daylight (not muddy yellow wash).
 */
const PODCAST_YOUTUBE_ILLUSTRATION_STYLE = `Create a densely detailed cinematic digital travel illustration for a Florida theme-park news podcast YouTube still.
Match the first Florida Buzz YouTube episode look: ultra-sharp micro-detail (weathered materials, fabric weave, stone grain, pipes, lantern metalwork, individual paving stones), crowded layered depth, immersive eye-level composition, polished high-end concept-art fidelity — not soft blurry painterly wash, not flat stock photo, not sterile corporate brochure, not cartoon, not collage, not multi-land mashup.

Composition: strong foreground subject, story-relevant environment filling the frame with dense midground/background activity, natural depth of field, balanced 16:9.

Lighting and color: bright directional Florida daylight with NATURAL white balance. Keep sunlight and contrast, but avoid heavy yellow/amber/orange grading washes. Metal reads cool silver-grey; skin tones natural; sky can hold true blue; foliage true green; building colors accurate. High micro-contrast and crisp edges.

Anonymous park visitors may appear naturally when they help the scene feel alive. Do not depict celebrities, named characters, or identifiable public figures. Anatomy must stay believable.

The visual must directly represent the ONE story place being discussed — one real Walt Disney World hotel, attraction, land gateway, or construction site. Never invent mashup parkscapes or unrelated icons. Do not invent announced designs as completed attractions.

No captions, headlines, readable signs, official logos, watermarks, borders, or distorted text.`;

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
  return applyStyleBlock(prompt, PODCAST_YOUTUBE_ILLUSTRATION_STYLE);
}

module.exports = {
  EDITORIAL_PHOTO_STYLE,
  PODCAST_YOUTUBE_ILLUSTRATION_STYLE,
  applyStyleBlock,
  withEditorialPhotoStyle,
  withPodcastYoutubeStyle,
};
