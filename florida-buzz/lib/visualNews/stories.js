'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');

/**
 * Exact-ish Florida Buzz CTA endings used across samples.
 * Spoken VO should end with one of these (or close paraphrase).
 */
const CTA_SPOKEN = 'Follow Florida Buzz.';
const CTA_CAPTION = 'Follow Florida Buzz · thefloridabuzz.com';

const LIGHTNING_LANE_WORTH_IT = Object.freeze({
  id: 'lightning-lane-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  location: 'Magic Kingdom',
  // No AI presenter. Story-specific park stills only.
  presenter: false,
  // Geno-style delivery tags (ElevenLabs v4 audio tags).
  spoken: `[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth emptying the wallet? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 2.8, text: 'Lightning Lane $$$', highlight: '$$$' },
    { start: 2.8, end: 5.6, text: 'Up to $229 — new highs', highlight: '$229' },
    { start: 5.6, end: 8.4, text: 'Seven Dwarfs Mine Train' },
    { start: 8.4, end: 11.0, text: 'Standby: 50 minutes', highlight: '50 minutes' },
    { start: 11.0, end: 13.8, text: 'Worth emptying the wallet?', highlight: 'wallet' },
    { start: 13.8, end: 17.2, text: 'Pay only if it saves your morning', highlight: 'saves your morning' },
    { start: 17.2, end: 22.0, text: 'Record price ≠ automatic yes', highlight: 'automatic yes' },
  ],
  // Extra ASS money accents (PNG overlays carry the heavy visual punch).
  accents: [
    { start: 0.3, end: 2.6, text: '$$$$ PRICE HIT' },
    { start: 11.2, end: 13.6, text: 'EMPTY WALLET?' },
  ],
  stills: [
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'right',
      zoomEnd: 1.13,
      weight: 0.55,
    },
    {
      file: 'big-thunder-lightning-lane.jpg',
      path: path.join(REFS, 'big-thunder-lightning-lane.jpg'),
      credit: 'Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons',
      pan: 'left',
      zoomEnd: 1.1,
      weight: 0.45,
    },
  ],
  ctaSpoken: CTA_SPOKEN,
  ctaCaption: CTA_CAPTION,
  // Enable wallet / $$$$ / $229 PNG overlays in the sample pipeline.
  moneyOverlays: true,
  notes: [
    'Price-impact graphics ($$$$, empty wallet, up-to-$229 badge) are intentional visual accents.',
    'No AI presenter / host cutout.',
    'Visuals: licensed Magic Kingdom stills + generated money overlays.',
    'Voice: Geno (ElevenLabs bg7PC2IzyIDwYgytMiW1).',
  ],
});

function getStory(id) {
  if (id === LIGHTNING_LANE_WORTH_IT.id) return LIGHTNING_LANE_WORTH_IT;
  throw new Error(`Unknown visual news story: ${id}`);
}

module.exports = {
  REFS,
  CTA_SPOKEN,
  CTA_CAPTION,
  LIGHTNING_LANE_WORTH_IT,
  getStory,
};
