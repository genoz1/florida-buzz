// Takes the form data posted to /admin/submit-review (passed in via env vars,
// since this runs as a detached background process — see routes/main.js for
// why) and turns it into a published, first-person review article. Mirrors
// the same honesty rule as every other writer in this codebase: only the
// facts the reviewer actually provided get used — nothing is invented.
require('dotenv').config();
const { supabase, storeGeneratedImage } = require('../lib/supabase');
const { askClaude } = require('../lib/anthropic');
const { generateArticleImage } = require('../lib/imageGen');
const { createPin } = require('../lib/pinterest');
const { createPost: createInstagramPost } = require('../lib/instagram');
const { createPost: createThreadsPost } = require('../lib/threads');
const { postToFacebookPage } = require('../lib/facebook');
const { notifyIndexNow } = require('../lib/indexnow');

const DRY_RUN = process.env.DRY_RUN === 'true';

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

async function generateUniqueSlug(baseTitle) {
  const base = slugify(baseTitle);
  if (!supabase) return `${base}-${Date.now().toString(36)}`;

  let candidate = base;
  let suffix = 2;
  while (true) {
    const { data } = await supabase.from('articles').select('slug').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

const FIELD_LABELS = {
  subject_name: 'Subject name/location',
  visits: 'Visit history',
  standout_dishes: 'Standout dishes',
  skip: 'Anything to skip',
  atmosphere: 'Atmosphere & service',
  value: 'Value & who it\u2019s for',
  new_or_renovated: 'New or renovated, and what changed',
  standout: 'What stands out',
  falls_flat: 'What falls flat',
  practical: 'Practical notes',
  rooms: 'Rooms & theming',
  amenities: 'Amenities & location',
  highlights: 'Onboard highlights',
  castaway: 'Castaway Cay / Lookout Cay',
};

async function writeReview({ reviewType, reviewerName, reviewerBackground, subjectName, answers, memory, rating }) {
  const answerLines = Object.entries(answers)
    .filter(([, value]) => value && value.trim())
    .map(([key, value]) => `${FIELD_LABELS[key] || key}: ${value.trim()}`)
    .join('\n');

  const system = `You are ghostwriting a first-person Disney review for The Florida Buzz, in the
voice of a real reviewer named ${reviewerName}. This is a genuine, firsthand review based on
${reviewerName}'s own real visits — NOT staff-written news and NOT AI-researched content.

CRITICAL RULES:
- Only use facts, opinions, and details the reviewer actually provided below. Never invent a
  dish, a price, a date, a detail, or an opinion they didn't state.
- Write entirely in first person ("I've been coming here since...", "My favorite dish is...").
- If the reviewer gave you sparse notes, write a shorter, still-genuine review rather than
  padding it with invented specifics.
- Tone: warm, honest, conversational — like a knowledgeable friend telling you about a place
  they actually know well, not a press release or a generic listicle.
- Never claim any special access, insider status, or affiliation with Disney.

Respond ONLY with valid JSON, no markdown fences, no preamble. Schema:
{
  "title": "string, under 70 characters, written the way this reviewer would title their own review",
  "meta_title": "string, under 60 characters, natural search phrasing (e.g. 'Coral Reef Restaurant Review — Epcot')",
  "dek": "string, one-sentence subhead, under 140 characters",
  "body_html": "string, 4-7 short paragraphs as <p> tags, first-person, original wording, based only on the facts given",
  "fb_caption": "string, Facebook post: 1-2 sentences plus a relevant emoji, ends with 'Full review \\u2193' — no hashtags. Name the specific place being reviewed clearly, and make clear the reviewer has a real, specific verdict or standout detail — but hold that detail back rather than stating it, so there's a genuine reason to click through and read it.",
  "pin_title": "string, under 100 characters, descriptive and keyword-rich",
  "pin_description": "string, 1-2 sentences, under 500 characters, naturally including relevant search terms"
}`;

  const user = `Reviewer: ${reviewerName}
Reviewer's Disney background: ${reviewerBackground || '(not provided)'}
Review type: ${reviewType}
Subject: ${subjectName}

${answerLines || '(no additional details provided)'}

${memory ? `A specific memory the reviewer shared: ${memory}` : ''}
${rating ? `Reviewer's rating: ${rating}/5` : ''}`;

  const raw = await askClaude(system, user, 1400);
  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error('Could not parse a valid review from the AI response');
  }
}

async function run() {
  const reviewType = process.env.REVIEW_TYPE;
  const category = process.env.REVIEW_CATEGORY;
  const reviewerName = process.env.REVIEWER_NAME;
  const reviewerBackground = process.env.REVIEWER_BACKGROUND;
  const subjectName = process.env.SUBJECT_NAME;
  const memory = process.env.MEMORY;
  const rating = process.env.RATING ? parseInt(process.env.RATING, 10) : null;
  const answers = JSON.parse(process.env.ANSWERS_JSON || '{}');
  const providedPhotoUrl = process.env.PHOTO_URL || null;

  console.log(`=== Submitting ${reviewType} review of "${subjectName}" by ${reviewerName} ===`);

  let review;
  try {
    review = await writeReview({ reviewType, reviewerName, reviewerBackground, subjectName, answers, memory, rating });
  } catch (err) {
    console.error(`[error] AI writing failed: ${err.message}`);
    process.exit(1);
  }

  const slug = await generateUniqueSlug(review.meta_title || review.title);

  let finalImage = providedPhotoUrl;
  if (!finalImage) {
    console.log('No photo provided — generating an AI image instead.');
    finalImage = await generateArticleImage({ title: review.title, category, slug });
  }

  if (DRY_RUN) {
    console.log(`[dry-run] Title: ${review.title}`);
    console.log(`[dry-run] Body: ${review.body_html}`);
    return;
  }

  if (supabase) {
    const { error } = await supabase.from('articles').insert({
      slug,
      title: review.title,
      meta_title: review.meta_title,
      dek: review.dek,
      body_html: review.body_html,
      category,
      source_name: reviewerName,
      source_url: process.env.SITE_URL,
      image_url: finalImage,
      fb_caption: review.fb_caption,
      is_evergreen: true,
      is_review: true,
      review_type: reviewType,
      review_subject: subjectName,
      review_rating: rating,
    });
    if (error) {
      console.error(`[error] Could not save review: ${error.message}`);
      process.exit(1);
    }
    console.log(`Saved review: /article/${slug}`);
    await notifyIndexNow(`${process.env.SITE_URL}/article/${slug}`);
  }

  const articleUrl = `${process.env.SITE_URL}/article/${slug}`;

  await postToFacebookPage({ message: review.fb_caption, link: articleUrl, imageUrl: finalImage, dryRun: DRY_RUN });

  if (process.env.PINTEREST_ACCESS_TOKEN && process.env.PINTEREST_BOARD_ID && finalImage) {
    try {
      await createPin({ imageUrl: finalImage, title: review.pin_title, description: review.pin_description, link: articleUrl });
    } catch (err) {
      console.error(`[error] Pinterest post failed: ${err.message}`);
    }
  }

  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID && finalImage) {
    try {
      await createInstagramPost({ imageUrl: finalImage, caption: review.fb_caption.replace(/Full review\s*↓\s*$/i, 'Full review — link in bio') });
    } catch (err) {
      console.error(`[error] Instagram post failed: ${err.message}`);
    }
  }

  if (process.env.THREADS_ACCESS_TOKEN && process.env.THREADS_USER_ID) {
    try {
      const withoutSuffix = review.fb_caption.replace(/Full review\s*↓\s*$/i, '').trim();
      const threadsText = withoutSuffix ? `${withoutSuffix}\n\n${articleUrl}` : articleUrl;
      await createThreadsPost({ text: threadsText, imageUrl: finalImage });
    } catch (err) {
      console.error(`[error] Threads post failed: ${err.message}`);
    }
  }

  console.log('=== Review submission complete ===');
}

run().catch((err) => {
  console.error('Fatal error in submit-review run:', err);
  process.exit(1);
});
