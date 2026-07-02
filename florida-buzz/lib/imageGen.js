const { storeGeneratedImage } = require('./supabase');
const { askClaude } = require('./anthropic');
const { generateImage } = require('./openai');

// Writes an image prompt for the article, and generates + permanently stores the image.
// Deliberately generic/thematic rather than trying to depict the specific real event,
// and explicitly avoids real people, brand logos, and copyrighted characters —
// the image model's own content policy blocks most of this anyway, but we ask
// cleanly up front rather than relying on that as the only safeguard.
async function generateArticleImage({ title, category, slug }) {
  // Theme parks get a different treatment: attempts at a generic "big thrill ride"
  // scene kept drifting into unrelated territory (or risked looking too close to
  // real, trademarked parks). A travel-planning flat-lay sidesteps both problems —
  // it's about the trip, not the place, so there's no real scene to get wrong.
  if (category === 'theme-parks') {
    const flatLaySystem = `You write concise, vivid prompts for an AI image generator,
for a Florida travel site called The Florida Buzz. Write a prompt for an overhead
flat-lay photo of travel-planning essentials on a wooden table or beach towel:
things like a paper park map or brochure (blank/generic, no real logos or text),
sunglasses, a phone showing a blank map app, a wristband or lanyard (no branding),
ticket stubs (generic, no real park or airline names/logos), a small palm leaf,
sunscreen, maybe a passport. Bright, warm, editorial travel-blog photography style.
Absolutely no real logos, no readable brand names, no copyrighted characters.
Respond with ONLY the image prompt text, nothing else — no preamble, no quotes.`;

    let imagePrompt;
    try {
      imagePrompt = await askClaude(flatLaySystem, `Headline: ${title}`, 150);
    } catch (err) {
      console.error(`  [error] Could not write image prompt: ${err.message}`);
      return null;
    }

    let imageBuffer;
    try {
      imageBuffer = await generateImage(`${imagePrompt}. Photorealistic, warm natural lighting, overhead flat-lay editorial photography style.`);
    } catch (err) {
      console.error(`  [error] Image generation failed: ${err.message}`);
      return null;
    }

    return storeGeneratedImage(imageBuffer, `${slug}.png`);
  }

  const promptSystem = `You write concise, vivid prompts for an AI image generator, for
a Florida lifestyle news site called The Florida Buzz. The image accompanies an article
but must NOT depict the specific real event, any real named person, or any
copyrighted/trademarked character, logo, or architecture (e.g. no Disney castle, no
Mickey Mouse, no branded theme park attractions by name or unmistakable likeness).

CRITICAL — this must look unmistakably like Florida, not a generic or wrong-region scene:
Florida is famously flat with NO cliffs, NO mountains, NO rocky/pebble beaches, and NO
snow. Correct Florida terrain and features to draw from: flat sandy white or tan beaches,
palm trees, live oaks draped in Spanish moss, mangroves, flat marshland/wetlands,
Everglades-style saw grass, low-rise Florida architecture, orange/citrus groves, lakes,
springs. A "cold front" story should still show a recognizably Florida scene (e.g. a
Florida beach or oak canopy under grey winter light) — never a European or mountainous
coastline, however moody or dramatic that might otherwise look.

Use the specific headline to pick a specific, relevant scene — not just the category.
A springs guide should show a natural spring (clear blue-green water, limestone, tubers
or swimmers), not a generic beach.

Write a prompt for a generic, warm, photorealistic scene that captures the general mood
and setting of the article while staying geographically accurate to Florida. Respond
with ONLY the image prompt text, nothing else — no preamble, no quotes.`;

  const promptUser = `Headline: ${title}\nCategory: ${category}`;

  let imagePrompt;
  try {
    imagePrompt = await askClaude(promptSystem, promptUser, 150);
  } catch (err) {
    console.error(`  [error] Could not write image prompt: ${err.message}`);
    return null;
  }

  let imageBuffer;
  try {
    imageBuffer = await generateImage(`${imagePrompt}. Photorealistic, warm natural lighting, editorial photography style.`);
  } catch (err) {
    console.error(`  [error] Image generation failed: ${err.message}`);
    return null;
  }

  return storeGeneratedImage(imageBuffer, `${slug}.png`);
}

module.exports = { generateArticleImage };
