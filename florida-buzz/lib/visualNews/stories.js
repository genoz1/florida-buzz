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
  // Fewer words per beat — kinetic social-news captions (park stays the hero).
  captions: [
    { start: 0.0, end: 2.3, text: 'RECORD HIGH', highlight: 'RECORD' },
    // $229 beat handled by premium PNG callout — light caption only
    { start: 2.3, end: 5.5, text: 'NEW HIGH', highlight: 'HIGH' },
    { start: 5.5, end: 8.2, text: 'SEVEN DWARFS', highlight: 'SEVEN DWARFS' },
    { start: 8.2, end: 10.8, text: '50 MIN WAIT', highlight: '50 MIN' },
    { start: 10.8, end: 13.4, text: 'WORTH IT?', highlight: 'WORTH IT?' },
    { start: 13.4, end: 17.0, text: 'PAY ONLY IF IT HELPS', highlight: 'ONLY IF' },
    { start: 17.0, end: 22.0, text: 'NOT AN AUTO YES', highlight: 'AUTO YES' },
  ],
  // No spam ASS money accents ($$$$ / EMPTY WALLET) — clean system.
  accents: [],
  stills: [
    {
      file: 'priority-access-entrance.jpg',
      path: path.join(REFS, 'priority-access-entrance.jpg'),
      credit: 'Priority / Lightning Lane entrance reference still (Magic Kingdom area)',
      pan: 'up',
      zoomEnd: 1.18,
      weight: 0.22,
    },
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'right',
      zoomEnd: 1.2,
      weight: 0.28,
    },
    {
      file: 'big-thunder-lightning-lane.jpg',
      path: path.join(REFS, 'big-thunder-lightning-lane.jpg'),
      credit: 'Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons',
      pan: 'left',
      zoomEnd: 1.16,
      weight: 0.25,
    },
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'down',
      zoomEnd: 1.22,
      weight: 0.25,
    },
  ],
  ctaSpoken: CTA_SPOKEN,
  ctaCaption: CTA_CAPTION,
  // One premium price callout (not wallet/$$$$ sticker dump).
  moneyOverlays: true,
  notes: [
    'Visual system: clean kinetic captions + one premium $229 callout (no wallet/$$$$ stickers).',
    'No AI presenter / host cutout.',
    'Visuals: licensed Magic Kingdom stills with stronger Ken Burns cut rhythm.',
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
