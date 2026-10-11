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
  spoken: `[curious] Lightning Lane Single Pass just hit new highs for November first. Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 3.0, text: 'Lightning Lane hit new highs', highlight: 'new highs' },
    { start: 3.0, end: 6.2, text: 'Seven Dwarfs Mine Train' },
    { start: 6.2, end: 9.4, text: 'Standby: 50 minutes', highlight: '50 minutes' },
    { start: 9.4, end: 12.6, text: 'So is it worth it?', highlight: 'worth it' },
    { start: 12.6, end: 16.8, text: 'Pay only if it saves your morning', highlight: 'saves your morning' },
    { start: 16.8, end: 22.0, text: 'Record price ≠ automatic yes', highlight: 'automatic yes' },
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
  notes: [
    'No invented dollar amounts.',
    'No AI presenter / host cutout.',
    'Visuals: licensed Magic Kingdom stills only.',
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
