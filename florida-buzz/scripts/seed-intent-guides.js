#!/usr/bin/env node
'use strict';

/**
 * Seed high-purchase-intent evergreen guides (hotels, cruise stays, insurance, itinerary).
 * Uses stable /go/hotels redirects so Hotels.com affiliate URLs can rotate via env.
 *
 * Usage:
 *   node scripts/seed-intent-guides.js
 *   DRY_RUN=1 node scripts/seed-intent-guides.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SITE_URL = (process.env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const BYLINE = 'Gene Zentko';

function supabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.FLORIDA_BUZZ_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FLORIDA_BUZZ_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function shopBox({ eyebrow, body, href, cta }) {
  return `
<div class="shop-box">
  <div class="shop-box-text">
    <p class="shop-box-eyebrow">${eyebrow}</p>
    <p>${body}</p>
  </div>
  <a href="${href}" class="shop-box-cta" target="_blank" rel="nofollow sponsored noopener">${cta}</a>
</div>`;
}

function hotelsBox(dest, label) {
  return shopBox({
    eyebrow: 'Where to Stay',
    body: `Compare current rates for ${label} on Hotels.com — a Florida Buzz affiliate partner. If you book through our link, we may earn a commission at no extra cost to you.`,
    href: `${SITE_URL}/go/hotels/${dest}`,
    cta: 'Compare Hotels.com rates',
  });
}

function ticketsBox() {
  const href = process.env.UNDERCOVER_TOURIST_URL
    || `https://www.jdoqocy.com/click-101851476-15733832?url=${encodeURIComponent('https://www.undercovertourist.com/disney/')}`;
  return shopBox({
    eyebrow: 'Park Tickets',
    body: 'When you are ready to buy Disney or Universal tickets, compare current deals with our partner Undercover Tourist. We may earn a commission at no extra cost to you.',
    href,
    cta: 'Compare ticket deals',
  });
}

function carRentalBox() {
  const href = `https://www.jdoqocy.com/click-101851476-15733832?url=${encodeURIComponent('https://www.undercovertourist.com/car-rental/')}`;
  return shopBox({
    eyebrow: 'Rental Cars',
    body: 'Compare Orlando rental-car rates through Undercover Tourist (Alamo, Avis, Budget, Enterprise, National and more). Affiliate disclosure: we may earn a commission at no extra cost to you.',
    href,
    cta: 'Compare rental-car rates',
  });
}

const GUIDES = [
  {
    slug: 'best-hotels-near-disney-world-orlando',
    title: 'Best Hotels Near Disney World: How to Choose Without Overpaying',
    dek: 'A practical stay guide for Lake Buena Vista and nearby Orlando — distance, value, and when an official Disney hotel is worth it.',
    category: 'theme-parks',
    body_html: `
<p>Picking a hotel near Walt Disney World is less about finding a “perfect” resort and more about matching three things: how early you want to be in the parks, how much transit friction you’ll tolerate, and what you actually want to spend on sleep versus tickets and dining.</p>
<p>Most first-time visitors over-index on staying on Disney property. That can be right — Extra Magic Hours / Early Entry style perks, easier bus logistics, and a themed stay matter for some families — but plenty of trips run smoother (and cheaper) from a well-chosen hotel a short drive or shuttle away.</p>
${hotelsBox('disney', 'hotels near Disney World')}
<h2>Start with commute math, not star ratings</h2>
<p>Ask how you’ll get to Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom on a typical day. A cheaper hotel that adds 40 minutes each way can erase the savings in energy and Lightning Lane timing. A pricier room next to Disney Springs or along Hotel Plaza Boulevard can be the better value if it keeps rope drop realistic.</p>
<ul>
<li><strong>On-site Disney hotels:</strong> Best when you want transportation simplicity and park-morning perks.</li>
<li><strong>Disney Springs / Hotel Plaza area:</strong> Often the sweet spot for first-timers who want proximity without full resort pricing.</li>
<li><strong>I-Drive / Universal corridor:</strong> Makes sense for split Disney + Universal trips, less ideal for a Disney-only vacation.</li>
<li><strong>Kissimmee / south of the parks:</strong> Can be a strong value if you have a car and accept a longer morning drive.</li>
</ul>
<h2>What to compare before you book</h2>
<p>Look past the nightly rate. Check resort fees, parking, shuttle reliability, kitchenette options (huge for snack costs), and cancellation rules. For peak seasons — holidays, spring break, race weekends — flexible cancellation often matters more than saving $15 a night on a prepaid nonrefundable rate.</p>
<p>If you’re traveling with little kids, prioritize pool quality and laundry access over lobby grandeur. If you’re park-hopping adults, prioritize location and quiet rooms after late fireworks.</p>
${ticketsBox()}
<h2>A simple decision framework</h2>
<p>Choose <em>on-site</em> if park mornings are sacred and you don’t want to think about parking. Choose <em>nearby off-site</em> if you have a car (or a proven shuttle), want more food flexibility, and are hunting value. Split-stay only if your itinerary truly changes mid-trip — for example, Disney days first, Universal days second.</p>
<p>When rates look close, book the cancellable option first, then re-check prices once park tickets and dining reservations are locked. Lodging is easier to adjust than a fully paid ticket bundle.</p>
<p><em>By Gene Zentko. Some links are affiliate partners; if you book through them, Florida Buzz may earn a commission at no extra cost to you.</em></p>
`.trim(),
  },
  {
    slug: 'best-hotels-near-universal-orlando',
    title: 'Best Hotels Near Universal Orlando: On-Site vs Nearby Stays',
    dek: 'How to pick lodging for Universal Studios, Islands of Adventure, and Epic Universe — including when Universal hotels are worth the premium.',
    category: 'theme-parks',
    body_html: `
<p>Universal Orlando lodging decisions are sharper than Disney’s for one reason: walking distance and Early Park Admission can change a park day more than a nicer lobby. If your trip is Universal-heavy, hotel location is part of the attraction strategy, not a side detail.</p>
${hotelsBox('universal', 'hotels near Universal Orlando')}
<h2>When an official Universal hotel makes sense</h2>
<p>On-site Universal hotels are strongest when you want Early Park Admission, easier mid-day breaks, and less dependence on rideshares. Families doing multiple park days in a row often feel that convenience in their legs by day three.</p>
<p>If you’re only visiting Universal for one day inside a broader Orlando trip, a well-reviewed nearby hotel on or just off International Drive can be enough — especially if parking and commute times still let you arrive near open.</p>
<h2>Nearby areas that usually work</h2>
<ul>
<li><strong>Universal / Sand Lake corridor:</strong> Shortest off-site hops when you have a car.</li>
<li><strong>International Drive:</strong> Lots of inventory and restaurants; verify real drive time at rope drop, not midday Google estimates.</li>
<li><strong>Disney area hotels:</strong> Fine for split trips, weaker if every day is Universal-first.</li>
</ul>
<p>Epic Universe adds another commute variable. Don’t assume a hotel that was “close to Universal” five years ago is still the best base for your park mix — map the specific parks on your itinerary.</p>
${ticketsBox()}
<h2>Book for the itinerary you actually have</h2>
<p>Universal-only vacation? Bias toward on-site or the closest reputable off-site you can afford. Disney + Universal split? Consider changing hotels once, or pick a central base and budget rideshare on Universal mornings. Cruise + parks combo? You may want the Universal stay only for the park block, then move closer to Port Canaveral.</p>
<p>Compare cancellable rates first, then lock tickets. Room inventory moves, but a bad hotel commute is harder to fix mid-trip than a redepositable room night.</p>
<p><em>By Gene Zentko. Affiliate disclosure: we may earn a commission from hotel or ticket partners at no extra cost to you.</em></p>
`.trim(),
  },
  {
    slug: 'hotels-near-port-canaveral-cruise',
    title: 'Hotels Near Port Canaveral: Where to Stay the Night Before a Cruise',
    dek: 'A calm pre-cruise stay guide — proximity to the port, airport logistics, and what to book when sailing from Port Canaveral.',
    category: 'cruises',
    body_html: `
<p>The night before a Port Canaveral cruise should be boring in the best way: short morning drive, predictable parking or shuttle plan, and zero drama about missing embarkation. The “best” hotel is usually the one that protects your boarding morning.</p>
${hotelsBox('port-canaveral', 'hotels near Port Canaveral')}
<h2>Stay near the port if your flight lands late</h2>
<p>If you’re flying into Orlando (MCO) the day before, a Cocoa Beach / Cape Canaveral / Port Canaveral-area hotel often beats staying in Orlando and driving the whole Space Coast run at dawn with kids and luggage. Late flight + Orlando hotel + morning port traffic is how embarkation days go sideways.</p>
<ul>
<li><strong>Port-adjacent / Cape Canaveral:</strong> Shortest morning transfer; fewer variables.</li>
<li><strong>Cocoa Beach:</strong> More dining and beach time if you arrive early enough to enjoy it.</li>
<li><strong>Orlando / MCO area:</strong> Only ideal when you land early, want theme-park time, and accept a longer cruise-morning drive.</li>
</ul>
<h2>Checklist before you hit “book”</h2>
<p>Confirm parking rules if you’re leaving a car, shuttle cut-off times, and whether breakfast starts early enough for your boarding window. Also check hurricane-season and holiday traffic patterns — “25 minutes to the port” can become an hour.</p>
<p>If your cruise is paired with Disney or Universal days, do parks first, then move east for the final night. Trying to rope-drop Magic Kingdom and embark the same day is a stress hobby, not a plan.</p>
<p><em>By Gene Zentko. Some hotel links are affiliate partners; commissions never increase your price.</em></p>
`.trim(),
  },
  {
    slug: 'florida-travel-insurance-theme-park-cruise',
    title: 'Travel Insurance for Florida Trips: Parks, Cruises, and What Actually Matters',
    dek: 'A plain-English look at trip protection for Disney, Universal, and Port Canaveral sailings — when it’s worth it and what to compare.',
    category: 'travel-deals',
    body_html: `
<p>Florida trips concentrate a lot of prepaid risk: park tickets, hotels, flights, and sometimes a cruise deposit. Travel insurance is not exciting content, but it is one of the few purchases that can save a vacation budget when someone gets sick, a flight dies, or weather forces a change.</p>
<p>This is not personalized insurance advice. Policies differ. Read the certificate. The goal here is to know what to compare before you click buy.</p>
<h2>When insurance is usually worth a hard look</h2>
<ul>
<li>Nonrefundable park tickets + prepaid hotel for peak weeks</li>
<li>Cruise deposits with strict penalty schedules</li>
<li>International guests connecting through long-haul flights into MCO</li>
<li>Trips where one person’s illness would cancel the whole party’s plans</li>
</ul>
<h2>What to compare (not just the premium)</h2>
<p>Look at cancel-for-any-reason options (if offered), medical coverage, hurricane/tropical storm rules, and whether theme-park tickets or excursions are covered as prepaid expenses. Cheap policies that exclude the thing you’re worried about are not a deal.</p>
${process.env.TRAVEL_INSURANCE_URL ? shopBox({
    eyebrow: 'Protect the trip',
    body: 'Compare trip protection options before you finalize flights, hotels, and park tickets. Affiliate disclosure: we may earn a commission at no extra cost to you.',
    href: process.env.TRAVEL_INSURANCE_URL,
    cta: 'Compare travel insurance →',
  }) : `<p>When you have a preferred insurance partner link, Florida Buzz can surface it automatically beside planning tools. Until then, compare policies from major providers directly and match coverage to your prepaid costs.</p>`}
<h2>Practical timing</h2>
<p>Buy soon after your first major prepaid deposit if you want cancel protections that require early purchase. Waiting until the week before departure can limit options. Keep receipts for tickets, hotels, and cruises in one folder — claims love paperwork.</p>
${hotelsBox('orlando', 'Orlando and cruise-port hotels')}
<p><em>By Gene Zentko. Affiliate links, when present, may earn Florida Buzz a commission.</em></p>
`.trim(),
  },
  {
    slug: 'disney-world-trip-itinerary-framework',
    title: 'Disney World Trip Itinerary Framework: A Calm Plan You Can Actually Follow',
    dek: 'An evergreen planning framework for Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom — built around energy, not wishful rope-drop fantasies.',
    category: 'theme-parks',
    body_html: `
<p>Most Disney World itineraries fail for the same reason: they assume every day starts at rope drop and ends at fireworks with toddlers still smiling. A better plan is a framework — park priorities, rest blocks, and booking order — that you can adapt when waits spike or weather turns.</p>
${hotelsBox('disney', 'hotels near Disney World')}
<h2>Book in this order</h2>
<ol>
<li><strong>Dates + hotel</strong> (cancellable when possible)</li>
<li><strong>Park tickets</strong> matched to those dates</li>
<li><strong>Dining</strong> for must-do meals</li>
<li><strong>Lightning Lane / paid entry strategies</strong> once policies for your dates are clear</li>
<li><strong>Day-by-day park map</strong> using live waits the week of travel</li>
</ol>
<p>Use Florida Buzz wait times and the day planner when you’re close in. Distant itineraries should stay loose on ride order and firm on which park gets which day.</p>
<h2>A durable park mix</h2>
<p>Give Magic Kingdom the day your group has the most energy. Put Animal Kingdom on a hotter day if you can start early and nap midday. Hollywood Studios rewards a clear headliner priority list. EPCOT works well with a later start and a food-and-festival pacing mindset.</p>
${ticketsBox()}
<h2>Build rest on purpose</h2>
<p>One midday return to the hotel (or a long sit-down meal) beats a meltdown at 3 p.m. If your hotel commute makes midday breaks impossible, plan a slower evening and skip the fantasy of doing everything.</p>
<p>Revisit the plan three days out with current wait trends, then again the night before. The framework stays; the ride order flexes.</p>
<p><em>By Gene Zentko. Hotel and ticket partner links may earn a commission at no extra cost to you.</em></p>
`.trim(),
  },
  {
    slug: 'orlando-rental-car-disney-universal',
    title: 'Do You Need a Rental Car for Disney and Universal? An Orlando Decision Guide',
    dek: 'When a rental car saves a Florida park trip — and when rideshare, shuttles, or staying on-site are smarter.',
    category: 'travel-deals',
    body_html: `
<p>Orlando transportation is not one answer. A rental car is a tool: great for split Disney + Universal trips, Port Canaveral mornings, and grocery runs — expensive dead weight if you’re staying on-site and never leaving the Disney bubble.</p>
${carRentalBox()}
<h2>Rent a car if…</h2>
<ul>
<li>You’re park-hopping between Disney and Universal in the same trip</li>
<li>You’re staying off-site without a reliable shuttle</li>
<li>You want a beach day, outlet day, or Kennedy Space Center side trip</li>
<li>You’re driving to Port Canaveral before or after a cruise</li>
</ul>
<h2>Skip the rental if…</h2>
<ul>
<li>You’re 100% Disney on-site and happy with buses / skyliner / boats</li>
<li>Your hotel’s shuttle actually matches your rope-drop time (verify, don’t assume)</li>
<li>Parking fees + gas would erase any “freedom” benefit for a short trip</li>
</ul>
<h2>MCO pickup tips that matter</h2>
<p>Book the car for your real airport arrival window, not the optimistic one. Compare total price with taxes and young-driver fees, not the homepage teaser rate. If you’re landing late with kids, a hotel shuttle the first night and a morning rental pickup can be calmer than wrestling car seats at midnight.</p>
${hotelsBox('orlando', 'Orlando hotels')}
<p>Pair the car decision with lodging: a cheap Kissimmee hotel without a car can cost more in Uber than a slightly pricier room closer to the parks.</p>
${ticketsBox()}
<p><em>By Gene Zentko. Rental-car and hotel partner links may earn Florida Buzz a commission at no extra cost to you.</em></p>
`.trim(),
  },
  {
    slug: 'best-orlando-tours-and-day-trips',
    title: 'Best Orlando Tours and Day Trips Beyond the Theme Parks',
    dek: 'Airboat rides, Kennedy Space Center, Clearwater beaches, and other Florida day trips worth booking when you need a park break.',
    category: 'travel-deals',
    body_html: `
<p>Theme parks are the headline, but many Orlando vacations get better with one non-park day — especially on trips longer than five nights. The goal is not to collect tourist checkboxes; it’s to pick one outing that matches your group’s energy and drive tolerance.</p>
${hotelsBox('orlando', 'Orlando-area hotels')}
<h2>High-value day-trip categories</h2>
<ul>
<li><strong>Kennedy Space Center:</strong> Best for space fans and school-age kids; plan a full day and an early start from Orlando.</li>
<li><strong>Airboat / wetlands:</strong> Short half-day reset when parks feel loud; morning tours beat afternoon heat.</li>
<li><strong>Beach day (Clearwater / Cocoa):</strong> Worth it if someone in the group needs salt air more than another queue.</li>
<li><strong>Food or craft experiences in Orlando:</strong> Lower logistics, still feels like a “different” day.</li>
</ul>
<h2>How to book without wrecking the park plan</h2>
<p>Put tours on a naturally slower day — after a late fireworks night, or between Disney and Universal blocks. Avoid stacking a dawn tour the morning after rope drop. Confirm cancellation windows; Florida weather moves plans.</p>
<p>If you’re driving, treat the tour like a park day: water, snacks, and a backup indoor option. If you’re ridesharing, price the round trip before you “save” on skipping a rental car.</p>
${carRentalBox()}
<p>For park tickets on the other days, compare authorized sellers the same way you compare tour operators — total price, entry rules, and refund flexibility.</p>
${ticketsBox()}
<p><em>By Gene Zentko. Some links are affiliate partners; commissions never raise your price.</em></p>
`.trim(),
  },
  {
    slug: 'port-canaveral-cruise-planning-guide',
    title: 'Port Canaveral Cruise Planning Guide: Flights, Hotels, and Embarkation Day',
    dek: 'A practical Florida cruise-port playbook — MCO timing, pre-cruise hotels, parking vs transfers, and how to keep embarkation calm.',
    category: 'cruises',
    body_html: `
<p>Port Canaveral cruises fail in the logistics, not the itinerary. Missed embarkation windows usually come from optimistic flight connections, the wrong hotel base, or an embarkation-morning drive that looked fine on a map.</p>
${hotelsBox('port-canaveral', 'hotels near Port Canaveral')}
<h2>Flight rule of thumb</h2>
<p>Arrive the day before when you can. Same-day MCO → cruise port is a gamble once bags, kids, or storms enter the chat. Flying out the same evening you debark is similarly fragile — build buffer.</p>
<h2>Where to sleep the night before</h2>
<ul>
<li><strong>Cape Canaveral / port area:</strong> Shortest morning transfer</li>
<li><strong>Cocoa Beach:</strong> Better if you arrive early enough to enjoy the beach</li>
<li><strong>Orlando:</strong> Only if parks come first and you’re willing to drive east at dawn</li>
</ul>
<p>Book cancellable rates until flights are firm. Then lock the room.</p>
${carRentalBox()}
<h2>Parking, transfers, and the boring checklist</h2>
<p>Decide early: port parking, hotel shuttle, or rideshare. Screenshot confirmation numbers. Pack documents in a personal item, not a checked bag. Eat a real breakfast — cruise terminal snack lines are not a plan.</p>
<p>If your vacation mixes Disney or Universal with a cruise, do parks first, move toward the coast for the final night, then sail. Trying to rope-drop and embark on the same calendar day is how people write angry vacation diaries.</p>
<p><em>By Gene Zentko. Hotel and car-rental partner links may earn a commission at no extra cost to you.</em></p>
`.trim(),
  },
  {
    slug: 'universal-orlando-trip-itinerary-framework',
    title: 'Universal Orlando Trip Itinerary Framework: Parks, Early Entry, and Rest',
    dek: 'A practical Universal Studios, Islands of Adventure, and Epic Universe planning framework — priorities first, wish lists second.',
    category: 'theme-parks',
    body_html: `
<p>Universal Orlando rewards a clear headliner list more than a minute-by-minute fantasy schedule. Early Park Admission, Express strategies, and park order matter — but only after you’ve decided which parks get which days and where you’re sleeping.</p>
${hotelsBox('universal', 'hotels near Universal Orlando')}
<h2>Build the trip in layers</h2>
<ol>
<li>Hotel base (on-site vs nearby)</li>
<li>Park ticket type and which parks you’ll enter</li>
<li>Must-do headliners per park</li>
<li>One recovery block each day (meal, hotel, or show)</li>
<li>Wait-time adjustments the week of travel</li>
</ol>
<p>If Epic Universe is on the itinerary, don’t assume old “Universal corridor” hotel advice still maps cleanly — check drive times for the parks you actually booked.</p>
${ticketsBox()}
<h2>Energy beats optimism</h2>
<p>Put your longest walking day when the group is freshest. Keep one lighter evening. Use Florida Buzz wait times close to your visit; distant itineraries should stay flexible on ride order.</p>
<p>Split Disney + Universal trips work best with either a hotel change or a central base plus honest rideshare budgeting — not wishful thinking about “it’s all Orlando.”</p>
${carRentalBox()}
<p><em>By Gene Zentko. Hotel, ticket, and rental-car partner links may earn a commission at no extra cost to you.</em></p>
`.trim(),
  },
];

async function seed() {
  const sb = supabaseClient();
  if (!sb && !DRY_RUN) {
    console.error('Supabase credentials missing (SUPABASE_URL + service key).');
    process.exit(1);
  }

  for (const guide of GUIDES) {
    if (DRY_RUN) {
      console.log(`[dry-run] would upsert ${guide.slug} (${guide.category})`);
      continue;
    }
    const { data: existing } = await sb.from('articles').select('id, slug').eq('slug', guide.slug).maybeSingle();
    const row = {
      slug: guide.slug,
      title: guide.title,
      dek: guide.dek,
      body_html: guide.body_html,
      category: guide.category,
      source_name: BYLINE,
      source_url: SITE_URL,
      is_evergreen: true,
      published_at: existing ? undefined : new Date().toISOString(),
    };
    // Avoid wiping published_at on update
    if (existing) {
      delete row.published_at;
      const { error } = await sb.from('articles').update(row).eq('slug', guide.slug);
      if (error) {
        console.error(`Update failed ${guide.slug}: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`Updated /article/${guide.slug}`);
    } else {
      const { error } = await sb.from('articles').insert(row);
      if (error) {
        console.error(`Insert failed ${guide.slug}: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      console.log(`Inserted /article/${guide.slug}`);
    }
  }
  console.log(DRY_RUN ? 'Dry run complete.' : 'Intent guides seeded.');
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { GUIDES, seed };
