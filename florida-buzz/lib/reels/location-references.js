'use strict';

// A destination-agnostic catalog of verified location anchors. Records may
// represent theme parks, beaches, historic districts, trails, museums, or any
// other Florida place. Add only licensed images whose credit can travel with
// the Reel package; never let a language model invent an image URL or license.
const catalog = [
  {
    destination:/Magic Kingdom/i,
    location:/Haunted Mansion exterior/i,
    path:'/reels/references/magic-kingdom-haunted-mansion.jpg',
    credit:'HarshLight, CC BY 2.0, via Wikimedia Commons; cropped for 9:16 reference use'
  },
  {
    destination:/Magic Kingdom/i,
    location:/Big Thunder Mountain Railroad/i,
    path:'/reels/references/magic-kingdom-big-thunder.jpg',
    credit:'daryl_mitchell, CC BY-SA 2.0, via Wikimedia Commons'
  }
];

function locationReference(shot, topic) {
  const direct=shot?.reference;
  if(direct && /^\/reels\/references\/[a-z0-9-]+\.jpg$/.test(direct.path||'') && direct.credit)return direct;
  return catalog.find(item=>item.destination.test(String(topic?.destination||''))&&item.location.test(String(shot?.location||'')))||null;
}

module.exports={catalog,locationReference};
