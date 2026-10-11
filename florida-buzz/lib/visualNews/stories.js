'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const REFS = path.join(ROOT, 'public', 'reels', 'references');

const CTA_SPOKEN = 'Follow Florida Buzz.';
const CTA_CAPTION = 'Follow Florida Buzz · thefloridabuzz.com';

/**
 * Disney / Lightning Lane story — Magic Kingdom stills ONLY.
 * No Universal assets. No wallet prop photos. No AI presenter.
 * Visual-news auto-video format is paused after quality failures;
 * this story definition stays Disney-safe for a future approach.
 */
const LIGHTNING_LANE_WORTH_IT = Object.freeze({
  id: 'lightning-lane-worth-it',
  title: 'Lightning Lane hit record highs — worth it?',
  location: 'Magic Kingdom',
  presenter: false,
  spoken: `[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth it? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes. Follow Florida Buzz.`,
  captions: [
    { start: 0.0, end: 2.3, text: 'RECORD HIGH', highlight: 'RECORD' },
    { start: 2.3, end: 5.5, text: 'UP TO $229', highlight: '$229' },
    { start: 5.5, end: 8.2, text: 'SEVEN DWARFS', highlight: 'SEVEN DWARFS' },
    { start: 8.2, end: 10.8, text: '50 MIN WAIT', highlight: '50 MIN' },
    { start: 10.8, end: 13.4, text: 'WORTH IT?', highlight: 'WORTH IT?' },
    { start: 13.4, end: 17.0, text: 'PAY ONLY IF IT HELPS', highlight: 'ONLY IF' },
    { start: 17.0, end: 22.0, text: 'NOT AN AUTO YES', highlight: 'AUTO YES' },
  ],
  accents: [],
  stills: [
    {
      file: 'big-thunder-lightning-lane.jpg',
      path: path.join(REFS, 'big-thunder-lightning-lane.jpg'),
      credit: 'Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons',
      pan: 'up',
      zoomEnd: 1.12,
      weight: 0.22,
    },
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'right',
      zoomEnd: 1.12,
      weight: 0.26,
    },
    {
      file: 'magic-kingdom-big-thunder.jpg',
      path: path.join(REFS, 'magic-kingdom-big-thunder.jpg'),
      credit: 'Magic Kingdom - Big Thunder Mountain, CC BY-SA 2.0, Wikimedia Commons',
      pan: 'left',
      zoomEnd: 1.1,
      weight: 0.26,
    },
    {
      file: 'tron-mk.jpg',
      path: path.join(REFS, 'tron-mk.jpg'),
      credit: 'Tron Lightcycle Power Run (Magic Kingdom), Wikimedia Commons',
      pan: 'up',
      zoomEnd: 1.1,
      weight: 0.26,
    },
  ],
  ctaSpoken: CTA_SPOKEN,
  ctaCaption: CTA_CAPTION,
  moneyOverlays: false,
  notes: [
    'Disney / Magic Kingdom stills only — never Universal Express Entry.',
    'No wallet prop photos. No AI presenter.',
    'Auto visual-news format paused pending a better approach.',
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
