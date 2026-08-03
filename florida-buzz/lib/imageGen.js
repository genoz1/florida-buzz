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
  // real, trademarked parks). Rather than relying on a single flat-lay still-life
  // composition for every guide (which reads as repetitive at volume — lots of
  // "stuff arranged on a table" images back to back), this rotates between several
  // different composition types, all of which stay clear of any real, recognizable
  // landmark, logo, or character.
  if (category === 'theme-parks') {
    const themeParkImageSystem = `You write concise, vivid prompts for an AI image generator,
for a Florida travel site called The Florida Buzz. The image accompanies a theme-park
planning guide but must NOT depict the actual real park, ride, or attraction itself —
no real, recognizable landmark, logo, character, or branded attraction of any kind.

Pick ONE of these composition types for this image — vary which one you pick each time,
don't default to the same one every time:

1. TRAVEL-PLANNING FLAT LAY: 3-4 objects that evoke the SPECIFIC angle of this exact
   headline — not generic seasonal/vacation filler. Ask yourself what makes THIS story
   different from any other story in its category, and choose objects that reflect that
   specific detail. A story about exclusive/limited merchandise calls for objects that
   evoke exclusivity and access (a wristband, a folded ticket, a "members only" felt
   badge shape) alongside a plain garment — not just generic candy corn and leaves. A
   story about a specific price change calls for objects suggesting cost/value. A story
   about a new ride calls for objects suggesting motion/mechanism. Generic seasonal icons
   (candy corn, plain autumn leaves, a generic jack-o'-lantern) are the WEAK, default
   choice — only use them if nothing more specific to this headline's actual angle fits.
   Arrange in a setting that fits the topic — overhead on a wooden table, on a beach
   towel, on a hotel bed/nightstand, held in someone's hands (no visible face), on a car
   dashboard, on a café table.

2. GOLDEN-HOUR SILHOUETTE: an INVENTED, generic silhouette scene — for example, an
   imagined castle-like silhouette (with turret shapes/proportions clearly different
   from any real park's actual castle), an imagined drop-tower or coaster silhouette,
   string lights over a generic midway, or people walking toward a generic entrance
   archway (seen from behind, no visible faces). The specific invented shape should fit
   the headline's topic — e.g. a fairytale/classic-park topic suggests a castle-like
   shape, a thrill-ride topic suggests a drop-tower or coaster-track shape. CRITICAL:
   every shape must be your own invention, not a recognizable trace of any real
   building — no specific real park's actual silhouette, proportions, or profile.

3. POV / IN-MOTION SHOT: a first-person or over-the-shoulder view — hands holding a
   phone showing a blank/generic app screen, or a folded paper map, while walking;
   captures motion and life rather than static objects. No visible faces.

4. WIDE ENVIRONMENTAL SCENE: a wide shot of a generic queue line, string-lit walkway,
   or crowd of people from behind at golden hour — evokes the feeling of "being at a
   theme park" through atmosphere and light rather than any specific real structure.

All objects, structures, and scenes must be generic/unbranded — no real logos, no
readable brand names, no copyrighted characters, no recognizable real park architecture.
Bright, warm, editorial travel-blog photography style.

Respond with ONLY the image prompt text, nothing else — no preamble, no quotes.`;

    let imagePrompt;
    try {
      imagePrompt = await askClaude(themeParkImageSystem, `Headline: ${title}`, 200);
    } catch (err) {
      console.error(`  [error] Could not write image prompt: ${err.message}`);
      return null;
    }

    let imageBuffer;
    try {
      imageBuffer = await generateImage(`${imagePrompt}. Photorealistic, warm natural lighting, editorial travel photography style.`);
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

Never depict anything genuinely disgusting, off-putting, or appetite-killing — no pests,
insects, mold, filth, or spoiled food — even when the story itself is literally about a
health code violation, pest sighting, or inspection failure. For topics like that, depict
something adjacent and tasteful instead: a health inspector's clipboard, a "temporarily
closed" sign on a restaurant door, an empty dining room, a generic restaurant exterior —
never the literal violation itself.

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
