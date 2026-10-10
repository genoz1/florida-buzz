'use strict';

/**
 * Shared TTS pronunciation guidance for fal Gemini TTS style_instructions.
 * Keep spellings in scripts/dialogue as written; do not insert phonetic
 * respellings into host lines. fal may still ignore hints — this is advisory.
 *
 * Do not invent Disney affiliation or official-voice claims here.
 */
const PRONUNCIATION_MAP = [
  {
    term: 'Gena',
    // Host spelling stays Gena; spoken form matches Gina.
    guidance:
      'The host name Gena is spelled G-E-N-A but must be pronounced like Gina (JEEN-uh), never Jenna or Gee-nuh.',
  },
  {
    term: 'EPCOT',
    guidance:
      'EPCOT is two syllables, EP-cot (stress on the first syllable), never “ee-pot”, never “E-P-C-O-T” letter-by-letter.',
  },
];

function pronunciationStyleInstructions(entries = PRONUNCIATION_MAP) {
  return entries
    .map((entry) => String(entry.guidance || '').trim())
    .filter(Boolean)
    .join(' ');
}

function pronunciationHostBibleNote(entries = PRONUNCIATION_MAP) {
  const park = entries.find((e) => e.term === 'EPCOT');
  if (!park) return '';
  return 'Park names: EPCOT is pronounced EP-cot (two syllables, stress on first) — never write phonetic respellings in scripts.';
}

module.exports = {
  PRONUNCIATION_MAP,
  pronunciationStyleInstructions,
  pronunciationHostBibleNote,
};
