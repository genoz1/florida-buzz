require('dotenv').config();
const { supabase } = require('../lib/supabase');
const { askClaudeWithSearch } = require('../lib/anthropic');

const DRY_RUN = process.env.DRY_RUN === 'true';

// Populates the dining directory for one park at a time. Run with:
//   PARK=magic-kingdom node scripts/generate-dining-directory.js
// Add DRY_RUN=true to preview the researched list without saving it.
//
// Unlike the daily automation, this isn't meant to run on a schedule — run
// it manually whenever you want to (re)populate or refresh a park's dining
// list. Re-running for a park replaces its existing entries, so it's safe
// to run again later to pick up menu/restaurant changes.
const PARK_LABELS = {
  'magic-kingdom': 'Magic Kingdom at Walt Disney World',
  epcot: 'EPCOT at Walt Disney World',
  'hollywood-studios': "Disney's Hollywood Studios at Walt Disney World",
  'animal-kingdom': "Disney's Animal Kingdom at Walt Disney World",
  resorts: 'Walt Disney World Resort Hotels',
};

function parseJsonResponse(text) {
  const cleaned = text.replace(/^```json\s*|```\s*$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    console.error(`  [debug] Raw response was not valid JSON: "${cleaned.slice(0, 300)}..."`);
    throw new Error('Could not parse a valid restaurant list from the AI response');
  }
}

// Shared JSON schema instructions used by both the per-park and resorts
// prompts below — kept in one place so the two stay in sync.
const SCHEMA_INSTRUCTIONS = `Respond ONLY with a valid JSON array, no markdown fences, no preamble:
[
  {
    "name": "string",
    "land": "string",
    "service_type": "quick-service" | "table-service",
    "reservations": "required" | "recommended" | "not-accepted" | "walk-up-only",
    "dining_plan": "string or null",
    "character_dining": true | false,
    "characters": "string or null",
    "meal_periods": ["breakfast", "lunch", "dinner", "snacks"],
    "description": "string"
  }
]`;

async function researchParkDining(parkLabel) {
  const system = `You are a meticulous Disney dining researcher compiling a complete,
CURRENT restaurant directory for ${parkLabel}. Accuracy matters more than speed here —
someone could plan their whole day around this list, so verify with web search rather
than relying on memory. Restaurants open, close, and change policies fairly often, so
confirm each one is currently operating before including it.

Research thoroughly: search for "current" or "2026" restaurant lists for this specific
park, cross-check against official Disney dining pages where possible, and if you're
genuinely unsure whether a restaurant is still open, leave it out rather than guess.

For EVERY currently-operating restaurant, quick-service window, and dedicated snack
location in the park, provide:
- name: the restaurant's actual current name
- land: the themed area it's located in
- service_type: "quick-service" or "table-service"
- reservations: "required" (Advance Dining Reservations essentially mandatory to get in),
  "recommended" (walk-ups possible but hard), "not-accepted" (first-come, walk-up only),
  or "walk-up-only"
- dining_plan: describe current Disney Dining Plan status if you can verify it (e.g.
  "Table-Service Credit", "Quick-Service Credit", "2 Credits (Signature)"), or null if
  you cannot confirm current dining plan participation status
- character_dining: true only if characters regularly appear during the meal
- characters: which characters, if character_dining is true, otherwise null
- meal_periods: array from ["breakfast","lunch","dinner","snacks"] — which meals it's
  actually open for
- description: 2-3 sentences, warm and specific, in your own original wording — what
  makes this place worth knowing about, not just a restated fact list

${SCHEMA_INSTRUCTIONS}`;

  const user = `Research and list every current restaurant, quick-service spot, and snack
location at ${parkLabel}. Use enough web searches to be confident the list is accurate
and current as of today.`;

  const { text, searchesUsed } = await askClaudeWithSearch(system, user, 8000, 15);
  console.log(`  Used ${searchesUsed} web search${searchesUsed === 1 ? '' : 'es'} while researching.`);
  return parseJsonResponse(text);
}

// Resort dining is a fundamentally bigger, differently-shaped research task
// than a single park — roughly 25+ resorts across Value, Moderate, and
// Deluxe tiers, each with its own restaurants. Listing every quick-service
// grab-and-go counter at every resort would produce an unwieldy, low-signal
// page, so this deliberately scopes to what's actually worth knowing about:
// every table-service and signature restaurant, plus each resort's single
// main quick-service food court — not every minor snack stand. This mirrors
// how a real editorial dining guide curates rather than exhaustively lists
// every logistics detail.
async function researchResortDining() {
  const system = `You are a meticulous Disney dining researcher compiling a CURRENT
directory of notable dining across Walt Disney World's resort hotels — Value, Moderate,
and Deluxe tiers, plus Disney Springs-area hotels. Accuracy matters more than speed —
verify with web search rather than relying on memory, since resort restaurants open,
close, and rebrand fairly often.

Scope deliberately: for EACH resort, include every table-service and signature-dining
restaurant, plus that resort's main quick-service food court (one entry, not every
individual counter within it). Skip minor grab-and-go snack kiosks and pool bars unless
genuinely notable — the goal is a useful, readable directory, not an exhaustive list of
every logistics detail.

For each entry, provide:
- name: the restaurant's actual current name
- land: the name of the RESORT it's located at (e.g. "Disney's Grand Floridian Resort & Spa") — this is used to group entries by resort on the page
- service_type: "quick-service" or "table-service"
- reservations: "required" | "recommended" | "not-accepted" | "walk-up-only"
- dining_plan: current Disney Dining Plan status if verifiable, or null
- character_dining: true only if characters regularly appear during the meal
- characters: which characters, if character_dining is true, otherwise null
- meal_periods: array from ["breakfast","lunch","dinner","snacks"]
- description: 2-3 sentences, warm and specific, in your own original wording, and
  briefly note which resort it's at and that resort's tier (Value/Moderate/Deluxe)

${SCHEMA_INSTRUCTIONS}`;

  const user = `Research and list notable table-service, signature, and main quick-service
dining across Walt Disney World's resort hotels — covering a representative, genuinely
current spread of Value, Moderate, and Deluxe resorts. Use enough web searches to be
confident the list is accurate as of today.`;

  const { text, searchesUsed } = await askClaudeWithSearch(system, user, 14000, 25);
  console.log(`  Used ${searchesUsed} web search${searchesUsed === 1 ? '' : 'es'} while researching.`);
  return parseJsonResponse(text);
}

async function researchDiningDirectory(park, parkLabel) {
  if (park === 'resorts') return researchResortDining();
  return researchParkDining(parkLabel);
}

async function run() {
  const park = process.env.PARK;
  if (!park || !PARK_LABELS[park]) {
    console.error(`[error] Set PARK to one of: ${Object.keys(PARK_LABELS).join(', ')}`);
    process.exit(1);
  }

  console.log(`=== Dining directory research — ${PARK_LABELS[park]} — ${new Date().toISOString()} ===`);
  if (DRY_RUN) console.log('DRY RUN: nothing will be saved.\n');

  let restaurants;
  try {
    restaurants = await researchDiningDirectory(park, PARK_LABELS[park]);
  } catch (err) {
    console.error(`[error] Research failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`Found ${restaurants.length} current restaurant(s)/locations.`);

  if (DRY_RUN) {
    restaurants.forEach((r, i) => {
      console.log(`\n[dry-run] ${i + 1}. ${r.name} (${r.land})`);
      console.log(`  Service: ${r.service_type} | Reservations: ${r.reservations} | Dining Plan: ${r.dining_plan}`);
      console.log(`  Character dining: ${r.character_dining}${r.characters ? ` (${r.characters})` : ''}`);
      console.log(`  Meals: ${(r.meal_periods || []).join(', ')}`);
      console.log(`  ${r.description}`);
    });
    console.log('\n=== Dry run complete — nothing saved ===');
    return;
  }

  if (!supabase) {
    console.error('[error] Supabase not configured — cannot save.');
    process.exit(1);
  }

  // Replace this park's existing entries with the freshly-researched list,
  // so re-running the script later cleanly picks up restaurant/menu changes
  // rather than accumulating stale duplicate rows.
  const { error: deleteError } = await supabase.from('restaurants').delete().eq('park', park);
  if (deleteError) {
    console.error(`[error] Could not clear existing entries for ${park}: ${deleteError.message}`);
    process.exit(1);
  }

  const rows = restaurants.map((r) => ({
    park,
    name: r.name,
    land: r.land,
    service_type: r.service_type,
    reservations: r.reservations,
    dining_plan: r.dining_plan,
    character_dining: !!r.character_dining,
    characters: r.characters || null,
    meal_periods: r.meal_periods || [],
    description: r.description,
  }));

  const { error: insertError } = await supabase.from('restaurants').insert(rows);
  if (insertError) {
    console.error(`[error] Could not save restaurants: ${insertError.message}`);
    process.exit(1);
  }

  console.log(`Saved ${rows.length} restaurant(s) for ${park}.`);
  console.log(`View at: ${process.env.SITE_URL || 'https://thefloridabuzz.com'}/dining/${park}`);
  console.log('\n=== Run complete ===');
}

run().catch((err) => {
  console.error('Fatal error in generate-dining-directory run:', err);
  process.exit(1);
});
