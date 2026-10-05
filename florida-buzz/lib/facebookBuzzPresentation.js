const { generateValidatedImageResult } = require('./imageGen');
const { Jimp } = require('jimp');
const { storeGeneratedImage, supabase } = require('./supabase');

const IMAGE_BUCKET = 'article-images';

// Facebook-only presentation copy. The underlying Buzz Board questions and
// records remain untouched; this is the shorter, feed-native framing used by
// the Facebook publisher.
const FACEBOOK_PRESENTATIONS = {
  'disney-attraction-wait-not-worth-it': {
    hook: 'Which Disney ride is never worth the posted wait?',
    setup: 'Some attractions are great and still not worth losing an hour for. Which line makes you keep walking?',
    imageSubject: 'a candid guest-level view of a long outdoor attraction queue at Disney World, with the attraction entrance visible and no readable wait-time sign',
  },
  'when-disney-vacation-price-goes-too-far': {
    hook: 'Is a Disney vacation still worth the price—or has it become too expensive?',
    setup: 'Everyone has a different breaking point once tickets, hotels, food, and travel are added up. Where is yours?',
    imageSubject: 'a candid Disney World vacation scene with a family reviewing their trip budget on a phone at an outdoor table, with no readable screen text',
  },
  'retired-disney-experience-worth-bringing-back': {
    hook: 'Should Disney bring back retired attractions—or keep moving forward?',
    setup: 'The catch: something current has to make room for it. What are you restoring, and what are you willing to trade?',
    imageSubject: 'a nostalgic but photorealistic evening view inside a classic Disney World theme park, focused on established architecture and atmosphere rather than characters',
  },
  'rope-drop-or-slow-disney-morning': {
    hook: 'Rope drop at Disney: worth it or overrated?',
    setup: 'Shorter morning lines sound great until the whole family is exhausted by dinner. Which approach makes a better park day for you?',
    imageSubject: 'Disney World guests arriving at a theme park entrance just after sunrise, photographed candidly from behind with warm morning light',
  },
  'what-epcot-should-protect-most': {
    hook: 'Has EPCOT gotten better—or lost what made it special?',
    setup: 'The park can mix all four, but one of them has to lead. Which identity matters most to you?',
    imageSubject: 'a wide photorealistic EPCOT scene with Spaceship Earth and guests in the foreground, natural daylight and no festival text or overlays',
  },
  'animal-kingdom-half-day-reputation': {
    hook: 'Animal Kingdom: full-day park or half-day park?',
    setup: 'Ride-focused visitors often leave early, while others can stay until close. Which camp are you in?',
    imageSubject: 'a candid wide view of Disney Animal Kingdom with the Tree of Life, walking paths, landscaping, and natural guest activity',
  },
  'disney-transportation-tradeoff': {
    hook: 'Disney transportation: convenient perk or vacation time-waster?',
    setup: 'Waiting saves money, but having control can save a lot of vacation time. What matters more on your trip?',
    imageSubject: 'a candid Disney World transportation scene with a resort bus arriving while guests wait naturally at a clearly recognizable but text-free stop',
  },
  'one-disney-park-to-skip': {
    hook: 'Which Disney World park is the easiest one to skip?',
    setup: 'No park is an easy cut, but most travelers have a first choice when time gets tight. Which one loses its day?',
    imageSubject: 'a realistic Disney World directional decision moment with guests studying a park map near transportation, no readable text and no collage',
  },
  'disney-split-stay-worth-moving': {
    hook: 'Disney split stays: worth it or too much hassle?',
    setup: 'Two resorts can make one trip feel bigger, but packing and moving can break the rhythm. Would you do it?',
    imageSubject: 'a candid resort-hotel arrival scene at Disney World with neatly packed luggage beside travelers changing hotels, no readable branding',
  },
  'when-disney-resort-premium-is-worth-paying': {
    hook: 'Disney resorts: worth the premium or overpriced?',
    setup: 'Location and convenience can be valuable, but the price gap can pay for a lot elsewhere. Where do you draw the line?',
    imageSubject: 'a photorealistic view of an established Disney World resort exterior and pool area, photographed like a genuine travel photo without text overlays',
  },
  'hollywood-studios-complete-park-day': {
    hook: 'Hollywood Studios: full-day park or half-day park?',
    setup: 'Some guests can stay from opening to close; others feel finished by mid-afternoon. How long does it hold you?',
    imageSubject: 'a candid guest-level photograph of Disney Hollywood Studios with recognizable established park architecture, natural crowds, and late-afternoon light',
  },
  'disney-dining-planning-too-much-work': {
    hook: 'Disney dining reservations: part of the fun or too much work?',
    setup: 'Reservations can create great meals, but they can also make the day feel scheduled to the minute. Do you plan ahead or wing it?',
    imageSubject: 'a candid family dining scene at a Disney World restaurant with menus and food, no characters, no readable text, and a relaxed natural atmosphere',
  },
  'when-disney-park-hopping-wastes-time': {
    hook: 'Disney park hopping: freedom or waste of time?',
    setup: 'Changing parks sounds flexible until transportation and walking eat into the day. Is hopping worth it for you?',
    imageSubject: 'Disney World guests transferring between parks using official transportation, photographed candidly with natural movement and no readable signs',
  },
  'paid-line-skipping-value-at-disney': {
    hook: 'Disney’s paid line-skipping: worth it or overpriced?',
    setup: 'Buying back hours can feel smart, but paying extra after admission can sting. What makes it worth the price for you?',
    imageSubject: 'a realistic Disney attraction entrance showing a shorter priority queue beside a longer standby queue, with no readable signs or app screens',
  },
  'disney-pool-day-versus-extra-park-day': {
    hook: 'Disney pool day: smart break or wasted park time?',
    setup: 'Rest can rescue a long vacation, but giving up park time is hard after paying for the trip. Which choice wins for your family?',
    imageSubject: 'a relaxed candid afternoon at an established Disney World resort pool with families resting, realistic anatomy, and no text or characters',
  },
  'who-disney-character-dining-is-for': {
    hook: 'Disney character dining: magical or overpriced?',
    setup: 'The experience can be memorable, but the premium is real. Is it a must-do, a one-time splurge, or an easy skip?',
    imageSubject: 'a realistic themed family restaurant table at Disney World with a festive atmosphere and food, excluding branded characters and readable text',
  },
  'best-disney-rain-day-strategy': {
    hook: 'Rainy Disney days: lower crowds or ruined plans?',
    setup: 'A storm can clear the park or ruin the plan depending on how you handle it. What is your go-to rain strategy?',
    imageSubject: 'candid Disney World guests in ponchos walking through a recognizable park setting during a Florida rain shower, with realistic wet pavement',
  },
  'disney-queue-better-than-ride': {
    hook: 'Which Disney queue is better than the ride itself?',
    setup: 'Some queues tell such a good story that the attraction has trouble topping them. Which one comes to mind?',
    imageSubject: 'a richly detailed but photorealistic established Disney attraction queue interior with guests moving through naturally and no readable text',
  },
  'what-universal-does-better-than-disney': {
    hook: 'Does Universal do theme parks better than Disney now?',
    setup: 'Even loyal Disney fans usually have one answer. What does Universal clearly win for you?',
    imageSubject: 'a candid wide view inside Universal Orlando with recognizable established park architecture and natural guest activity, no added logos or text',
  },
  'universal-screen-ride-criticism': {
    hook: 'Does Universal rely too much on screen-based rides?',
    setup: 'Some guests are tired of simulators; others think the criticism is outdated. Where do you land?',
    imageSubject: 'a photorealistic exterior view of an established Universal Orlando simulator attraction with guests entering, without depicting a fake ride interior',
  },
  'islands-of-adventure-complete-lineup': {
    hook: 'Is Islands of Adventure Orlando’s best theme park?',
    setup: 'Its headliners are hard to beat, but some visitors see big gaps between them. Is the full lineup number one?',
    imageSubject: 'a wide candid view of Islands of Adventure with an established major attraction and themed landscape visible, natural daylight and crowds',
  },
  'universal-express-pass-price-limit': {
    hook: 'Universal Express: worth the price or wildly overpriced?',
    setup: 'Skipping lines can transform the day, but at some point it feels like buying admission twice. What is your limit?',
    imageSubject: 'a realistic Universal Orlando attraction entrance with separate express and standby flows, photographed candidly with no readable price or sign text',
  },
  'universal-theming-versus-ride-quality': {
    hook: 'Can great theming save a mediocre ride?',
    setup: 'A land can be beautiful even when its attractions miss for you. How much does atmosphere count?',
    imageSubject: 'a highly immersive established Universal Orlando themed land photographed as a genuine travel scene, emphasizing architecture and atmosphere',
  },
  'universal-resort-proximity-versus-room': {
    hook: 'At Universal, would you choose a better hotel room or a shorter walk?',
    setup: 'A nicer room is tempting, but effortless park access changes every day of the trip. Which would you choose?',
    imageSubject: 'a realistic Universal Orlando resort walkway with a hotel in view and guests heading toward transportation, no readable signs',
  },
  'universal-trip-for-younger-families': {
    hook: 'Universal with young kids: worth it or wait until they’re older?',
    setup: 'Thrill rides dominate the conversation, but not every child is tall enough or ready. Would you take a younger family now?',
    imageSubject: 'a candid younger family exploring an established family-friendly area at Universal Orlando, with realistic anatomy and no branded characters',
  },
  'citywalk-or-in-park-dining': {
    hook: 'CityWalk for lunch: better meal or wasted park time?',
    setup: 'CityWalk opens more options, but leaving can interrupt the day. Which choice is actually better?',
    imageSubject: 'a candid dining scene at Universal CityWalk with outdoor restaurant seating and guests, no readable restaurant names or menus',
  },
  'universal-park-to-park-pace': {
    hook: 'Universal park-to-park: must-have or exhausting?',
    setup: 'Access to both parks sounds ideal until the day turns into a race between headliners. How do you use it?',
    imageSubject: 'Universal Orlando guests moving between the two established parks through the connecting area, photographed candidly without readable signs',
  },
  'when-epic-universe-becomes-trip-anchor': {
    hook: 'Is Epic Universe worth planning an entire trip around?',
    setup: 'A new headliner can change the center of a Universal vacation. Has it earned that role for you yet?',
    imageSubject: 'a wide photorealistic view inside Epic Universe using only established real architecture and landscaping, with natural guest activity',
  },
  'florida-cruise-port-convenience': {
    hook: 'Would you choose a worse cruise for an easier Florida port?',
    setup: 'The ship and itinerary matter, but a painless embarkation day has real value. How much does the port influence you?',
    imageSubject: 'a candid travel photograph of passengers arriving at a modern Florida cruise terminal with a ship visible, no readable company names',
  },
  'short-premium-or-longer-budget-cruise': {
    hook: 'Better ship or more nights—which makes the better cruise?',
    setup: 'Better food and service are tempting, but so are extra nights at sea. Which would you choose?',
    imageSubject: 'a photorealistic cruise ship deck at sunset with comfortable seating and ocean views, photographed as a genuine travel moment',
  },
  'private-destination-or-local-port-day': {
    hook: 'Private island or real local port—which makes the better cruise day?',
    setup: 'One is polished and easy; the other can feel more authentic and unpredictable. Which experience do you want?',
    imageSubject: 'cruise passengers walking from a port toward a genuine Caribbean coastal town, candid and realistic with no private-island branding',
  },
  'cruise-line-loyalty-versus-itinerary': {
    hook: 'Cruise-line loyalty: smart perks or limiting your options?',
    setup: 'Loyalty perks are useful, but the right ports and ship can be hard to ignore. What would make you switch?',
    imageSubject: 'a traveler at a Florida cruise terminal looking toward two different cruise ships, with no readable brand names or artificial comparison graphics',
  },
  'florida-trip-too-much-driving': {
    hook: 'Florida road trips: worth the drive or too much windshield time?',
    setup: 'Florida distances fool a lot of visitors once traffic and stops are added. Which itinerary would you warn people about?',
    imageSubject: 'a candid Florida road-trip scene with a car on a flat highway, palm-lined landscape, and travelers taking a break, no readable map text',
  },
  'florida-beach-town-charm-versus-access': {
    hook: 'Would you tolerate terrible parking for a great Florida beach?',
    setup: 'Limited parking and slow traffic can protect the feel of a place—or ruin the visit. How much inconvenience will you tolerate?',
    imageSubject: 'a distinctive small Florida beach town street leading toward the ocean, with natural traffic, pedestrians, and coastal architecture',
  },
  'florida-tourist-attraction-locals-defend': {
    hook: 'Which Florida “tourist trap” is actually worth visiting?',
    setup: 'Some places get dismissed as tourist traps even though they still deliver a great day. Which one would you defend?',
    imageSubject: 'a candid busy scene at a recognizable established Florida roadside or family attraction, photographed naturally without readable branding',
  },
  'florida-experience-needs-more-than-day-trip': {
    hook: 'Which Florida destination is a mistake to visit for only one day?',
    setup: 'Some places only make sense once you slow down and stay awhile. Where would you spend at least two days?',
    imageSubject: 'a photorealistic relaxed evening in a distinctive Florida destination with walkable streets, local architecture, and natural visitor activity',
  },
};

function facebookImageFilename(slug) {
  return `facebook-buzz-${slug}.jpg`;
}

function instagramImageFilename(slug) {
  return `instagram-buzz-${slug}.jpg`;
}

function presentationFor(discussion) {
  const presentation = FACEBOOK_PRESENTATIONS[discussion?.slug];
  if (!presentation) {
    return {
      hook: discussion?.question,
      setup: 'There are strong opinions on both sides of this one. What is your take?',
      imageSubject: `a candid photorealistic Florida travel scene directly illustrating this discussion: ${discussion?.question}`,
    };
  }
  return presentation;
}

function buildFacebookCopy(discussion) {
  return presentationFor(discussion).hook;
}

function buildInstagramCopy(discussion, siteUrl = 'https://thefloridabuzz.com') {
  const presentation = presentationFor(discussion);
  const destination = new URL(`/go/ig/${encodeURIComponent(discussion.slug)}`, siteUrl).toString();
  return `${presentation.hook}\n\nAnswer here or continue the discussion on Buzz Board. Copy this short address into your browser: ${destination}`;
}

function buildFacebookImagePrompt(discussion) {
  const { imageSubject } = presentationFor(discussion);
  return `Create a candid, photorealistic editorial travel photograph of ${imageSubject}.
The image should feel like a real visitor captured the moment for a natural Facebook conversation post, not an advertisement or polished brand campaign.
No text overlay, caption, border, logo treatment, poster layout, infographic, collage, illustration, or branded social-media card.
Keep the image accurate to the named destination and exact discussion subject. Do not invent rides, buildings, signs, events, or recognizable characters.
Keep the primary subject near the center so the photograph also works as a clean square crop for Instagram.`;
}

function plannedFacebookImageUrl(client, slug) {
  if (!client?.storage) return null;
  return client.storage.from(IMAGE_BUCKET).getPublicUrl(facebookImageFilename(slug)).data.publicUrl;
}

async function ensureFacebookBuzzImage(discussion, {
  client = supabase,
  generateImageResult = generateValidatedImageResult,
  generateMissing = true,
} = {}) {
  if (!client?.storage) throw new Error('Supabase Storage is required for Facebook Buzz Board photos.');
  const bucket = client.storage.from(IMAGE_BUCKET);
  const filename = facebookImageFilename(discussion.slug);
  const publicUrl = bucket.getPublicUrl(filename).data.publicUrl;
  const { data, error } = await bucket.list('', { search: filename, limit: 1 });
  if (error) throw new Error(`Could not check Facebook Buzz Board photo: ${error.message}`);
  if ((data || []).some((entry) => entry.name === filename)) return publicUrl;
  if (!generateMissing) return publicUrl;

  const presentation = presentationFor(discussion);
  const result = await generateImageResult(buildFacebookImagePrompt(discussion), {
    title: presentation.hook,
    slug: `facebook-buzz-${discussion.slug}`,
    subject: presentation.imageSubject,
    location: discussion.category,
  });
  return result?.status === 'accepted' ? result.url : null;
}

async function ensureInstagramBuzzImage(discussion, {
  client = supabase,
  ensureFacebookImage = ensureFacebookBuzzImage,
  store = storeGeneratedImage,
  generateMissing = true,
} = {}) {
  if (!client?.storage) throw new Error('Supabase Storage is required for Instagram Buzz Board photos.');
  const bucket = client.storage.from(IMAGE_BUCKET);
  const filename = instagramImageFilename(discussion.slug);
  const publicUrl = bucket.getPublicUrl(filename).data.publicUrl;
  const { data, error } = await bucket.list('', { search: filename, limit: 1 });
  if (error) throw new Error(`Could not check Instagram Buzz Board photo: ${error.message}`);
  if ((data || []).some((entry) => entry.name === filename)) return publicUrl;
  if (!generateMissing) return publicUrl;

  const facebookUrl = await ensureFacebookImage(discussion, { client, generateMissing: true });
  if (!facebookUrl) return null;
  const { data: source, error: downloadError } = await bucket.download(facebookImageFilename(discussion.slug));
  if (downloadError || !source) throw new Error(`Could not prepare Instagram Buzz Board photo: ${downloadError?.message || 'photo unavailable'}`);
  const image = await Jimp.read(Buffer.from(await source.arrayBuffer()));
  const size = Math.min(image.width, image.height);
  image.crop({
    x: Math.round((image.width - size) / 2),
    y: Math.round((image.height - size) / 2),
    w: size,
    h: size,
  }).resize({ w: 1080, h: 1080 });
  return store(await image.getBuffer('image/jpeg', { quality: 80 }), filename, 'image/jpeg');
}

function buildFacebookPreview(discussion, siteUrl = 'https://thefloridabuzz.com') {
  const presentation = presentationFor(discussion);
  return {
    slug: discussion.slug,
    hook: presentation.hook,
    caption: buildFacebookCopy(discussion),
    instagramCaption: buildInstagramCopy(discussion, siteUrl),
    imageSubject: presentation.imageSubject,
    destination: new URL(`/go/buzz/${encodeURIComponent(discussion.slug)}`, siteUrl).toString(),
    unchangedBuzzBoardQuestion: discussion.question,
  };
}

module.exports = {
  FACEBOOK_PRESENTATIONS,
  buildFacebookCopy,
  buildFacebookImagePrompt,
  buildFacebookPreview,
  buildInstagramCopy,
  ensureFacebookBuzzImage,
  ensureInstagramBuzzImage,
  facebookImageFilename,
  instagramImageFilename,
  plannedFacebookImageUrl,
  presentationFor,
};
