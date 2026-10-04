const { normalizePlainText } = require('./validation');

const THREAT_PATTERNS = [
  /\b(?:i(?:'ll| will)|we(?:'ll| will))\s+(?:hurt|kill|attack|shoot)\b/i,
  /\b(?:bomb|shoot up)\s+(?:the|this|that)\b/i,
];
const SCAM_PATTERNS = [
  /\b(?:guaranteed returns?|double your money|wire (?:me|money)|crypto giveaway)\b/i,
  /\b(?:cashapp|venmo|zelle)\s+(?:me|at|to)\b/i,
];
const ABUSE_PATTERNS = [
  /\b(?:go kill yourself|kys)\b/i,
  /\b(?:doxx|dox)\s+(?:them|him|her|you)\b/i,
];

function repeatedSpam(body) {
  if (/(.)\1{8,}/iu.test(body)) return true;
  const words = body.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}']+/gu) || [];
  if (words.length >= 8) {
    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    if ([...counts.values()].some((count) => count >= 6)) return true;
  }
  return /\b(?:buy now|limited offer|act now)\b.*\b(?:buy now|limited offer|act now)\b/i.test(body);
}

function deterministicModeration(value) {
  const body = normalizePlainText(value);
  const signals = [];
  if (repeatedSpam(body)) signals.push('repetitive-spam');
  if (THREAT_PATTERNS.some((pattern) => pattern.test(body))) signals.push('credible-threat');
  if (SCAM_PATTERNS.some((pattern) => pattern.test(body))) signals.push('scam-solicitation');
  if (ABUSE_PATTERNS.some((pattern) => pattern.test(body))) signals.push('targeted-abuse');

  if (signals.includes('repetitive-spam')) return { decision: 'reject', signals };
  if (signals.length) return { decision: 'hold', signals };
  return { decision: 'publish', signals: [] };
}

function createModerationClassifier({ mode = 'deterministic', provider } = {}) {
  return async function classify(body) {
    const deterministic = deterministicModeration(body);
    if (deterministic.decision !== 'publish' || mode !== 'provider') return deterministic;
    if (typeof provider !== 'function') return { decision: 'hold', signals: ['moderation-unavailable'] };
    try {
      const result = await provider(body);
      if (!result || !['publish', 'hold', 'reject'].includes(result.decision)) {
        return { decision: 'hold', signals: ['moderation-invalid-result'] };
      }
      return { decision: result.decision, signals: Array.isArray(result.signals) ? result.signals : [] };
    } catch {
      return { decision: 'hold', signals: ['moderation-unavailable'] };
    }
  };
}

module.exports = { createModerationClassifier, deterministicModeration, repeatedSpam };
