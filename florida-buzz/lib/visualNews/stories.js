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
  // Keep in sync with baked Geno VO at /tmp/fb-visual-news-ll/voice.mp3
  spoken: `[excited] Lightning Lane Single Pass just smashed new highs — we're talking up to two hundred twenty-nine dollars. [curious] Look at Seven Dwarfs — Lightning Lane on one side, standby fifty minutes on the other. So... is it worth emptying the wallet? Here's the rule: pay only when that wait would wreck your morning, and you're already in the park that day. [serious] A record price is not an automatic yes. Follow Florida Buzz.`,
  // Fewer words per beat. Gap during $229 callout so the badge owns that moment.
  captions: [
    { start: 0.0, end: 2.3, text: 'RECORD HIGH', highlight: 'RECORD' },
    // 2.3–5.55: silent caption window — premium $229 PNG is the hero
    { start: 5.55, end: 8.2, text: 'SEVEN DWARFS', highlight: 'SEVEN DWARFS' },
    { start: 8.2, end: 10.8, text: '50 MIN WAIT', highlight: '50 MIN' },
    { start: 10.8, end: 13.4, text: 'WORTH IT?', highlight: 'WORTH IT?' },
    { start: 13.4, end: 17.0, text: 'PAY ONLY IF IT HELPS', highlight: 'ONLY IF' },
    { start: 17.0, end: 22.0, text: 'NOT AN AUTO YES', highlight: 'AUTO YES' },
  ],
  accents: [],
  // Magic Kingdom stills + one real MK queue plate for the wait beat.
  // No wallet photos, no Universal Express Entry, no California Adventure.
  stills: [
    {
      file: 'big-thunder-lightning-lane.jpg',
      path: path.join(REFS, 'big-thunder-lightning-lane.jpg'),
      credit: 'Big Thunder Mountain Lightning Lane, CC BY-SA 4.0, Wikimedia Commons',
      pan: 'up',
      zoomEnd: 1.2,
      weight: 0.18,
    },
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'right',
      zoomEnd: 1.22,
      weight: 0.26,
    },
    {
      file: 'tron-mk.jpg',
      path: path.join(REFS, 'tron-mk.jpg'),
      credit: 'Magic Kingdom queue / TRON area standby crowd still',
      pan: 'left',
      zoomEnd: 1.14,
      weight: 0.2,
    },
    {
      file: 'magic-kingdom-big-thunder.jpg',
      path: path.join(REFS, 'magic-kingdom-big-thunder.jpg'),
      credit: 'Magic Kingdom - Big Thunder Mountain, CC BY-SA 2.0, Wikimedia Commons',
      pan: 'up',
      zoomEnd: 1.18,
      weight: 0.18,
    },
    {
      file: 'seven-dwarfs-mine-train.jpg',
      path: path.join(REFS, 'seven-dwarfs-mine-train.jpg'),
      credit: 'Seven Dwarfs Mine Train (Magic Kingdom), CC BY 2.0, Wikimedia Commons',
      pan: 'down',
      zoomEnd: 1.24,
      weight: 0.18,
    },
  ],
  ctaSpoken: CTA_SPOKEN,
  ctaCaption: CTA_CAPTION,
  moneyOverlays: true,
  notes: [
    'Visual system: clean kinetic captions + one premium $229 callout (no wallet/$$$$ stickers).',
    'No AI presenter / host cutout.',
    'Visuals: Magic Kingdom stills + queue plate, stronger Ken Burns cut rhythm, bottom caption scrim.',
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
