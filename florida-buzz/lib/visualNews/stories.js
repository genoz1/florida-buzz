'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');

const CTA_SPOKEN = 'Follow Florida Buzz.';
const CTA_CAPTION = 'Follow Florida Buzz · thefloridabuzz.com';

/**
 * Static slideshow — one full-frame still per beat.
 * Beats: pricey rides → empty wallet photo → long line → tip/CTA.
 * No stacked sticker overlays.
 */
const LIGHTNING_LANE_WORTH_IT = Object.freeze({
  id: 'lightning-lane-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  location: 'Walt Disney World',
  presenter: false,
  spoken: `[excited] Lightning Lane Single Pass just hit record highs — up to two hundred twenty-nine dollars on the biggest rides. [curious] That's an empty wallet move for a lot of families. [serious] Your other option? A long standby line. [curious] So is it worth it? Only if that wait would wreck your morning. A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 3.2, text: 'LL HIT RECORD HIGHS', highlight: 'RECORD' },
    { start: 3.2, end: 6.4, text: 'UP TO $229', highlight: '$229' },
    { start: 6.4, end: 10.0, text: 'EMPTY WALLET?', highlight: 'EMPTY WALLET?' },
    { start: 10.0, end: 13.6, text: 'OR A LONG LINE', highlight: 'LONG LINE' },
    { start: 13.6, end: 17.8, text: 'PAY ONLY IF IT HELPS', highlight: 'ONLY IF' },
    { start: 17.8, end: 22.0, text: 'NOT AN AUTO YES', highlight: 'AUTO YES' },
  ],
  accents: [],
  stills: [
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      static: true,
      weight: 0.16,
    },
    {
      file: 'big-thunder-lightning-lane.jpg',
      path: path.join(REFS, 'big-thunder-lightning-lane.jpg'),
      credit: 'Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons',
      static: true,
      weight: 0.16,
    },
    {
      file: 'empty-wallet.jpg',
      path: path.join(REFS, 'empty-wallet.jpg'),
      credit: 'Leather wallet photo (Aarong leather wallet), Wikimedia Commons',
      static: true,
      weight: 0.18,
    },
    {
      file: 'long-line.jpg',
      path: path.join(REFS, 'long-line.jpg'),
      credit: 'Long outdoor queue — Queue, Belfast Mela, August 2010 (01).JPG, Wikimedia Commons',
      static: true,
      weight: 0.18,
    },
    {
      file: 'priority-access-entrance.jpg',
      path: path.join(REFS, 'priority-access-entrance.jpg'),
      credit: 'Priority / Lightning Lane entrance reference still',
      static: true,
      weight: 0.16,
    },
    {
      file: 'tron-mk.jpg',
      path: path.join(REFS, 'tron-mk.jpg'),
      credit: 'Tron Lightcycle Power Run (Magic Kingdom), Wikimedia Commons',
      static: true,
      weight: 0.16,
    },
  ],
  ctaSpoken: CTA_SPOKEN,
  ctaCaption: CTA_CAPTION,
  moneyOverlays: false,
  notes: [
    'Format: static full-frame stills in sequence (slideshow), not stacked overlays.',
    'Beats: pricey rides → empty wallet photo → long line → tip/CTA.',
    'No cheap sticker graphics. No AI presenter.',
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
