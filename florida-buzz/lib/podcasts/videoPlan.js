'use strict';

const crypto = require('crypto');
const { SEGMENT_MARKER_RE, formatScriptForTts } = require('./script');

const AUDIO_TAG_RE = /\[[a-z][a-z0-9 ,'-]{0,40}\]/gi;
const DEFAULT_IMAGES_PER_TOPIC = 2;

function plainSpeech(value) {
  return formatScriptForTts(String(value || ''), { keepSpeakerPrefix: false })
    .replace(AUDIO_TAG_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(value) {
  return plainSpeech(value).split(/\s+/).filter(Boolean).length;
}

function parseMarkedSegments(scriptText) {
  const lines = String(scriptText || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const segments = [];
  let slug = 'open';
  let bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    segments.push({ slug, text: bucket.join('\n'), words: wordCount(bucket.join('\n')) });
    bucket = [];
  };
  for (const line of lines) {
    const match = line.match(SEGMENT_MARKER_RE);
    if (match) {
      flush();
      slug = match[1].toLowerCase();
    } else {
      bucket.push(line);
    }
  }
  flush();
  return segments;
}

function splitNamedOpen(segment) {
  const text = String(segment?.text || '');
  const match = /\blet['’]?s go\b[.!]?/i.exec(text);
  if (!match) return { introText: text, agendaText: '', introWords: wordCount(text), agendaWords: 0 };
  const cut = match.index + match[0].length;
  const introText = text.slice(0, cut);
  const agendaText = text.slice(cut);
  return { introText, agendaText, introWords: wordCount(introText), agendaWords: wordCount(agendaText) };
}

function cleanTitle(value, fallback = 'Disney World Update') {
  const text = plainSpeech(value)
    .replace(/^(today|first|next|now|so|okay|all right)[,:-]?\s+/i, '')
    .split(/[.!?]/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.split(' ').slice(0, 11).join(' ');
}

function defaultTopic(segment, index) {
  const firstLine = String(segment.text || '').split(/\n+/).find((line) => plainSpeech(line)) || '';
  return {
    slug: segment.slug,
    title: cleanTitle(firstLine, `Disney World Update ${index + 1}`),
    category: segment.slug.replace(/-\d+$/, '') || 'disney-world-news',
  };
}

function stableVisualKey(topic, prompt, index) {
  const raw = `${topic.category}|${topic.title}|${prompt}|${index}`.toLowerCase();
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 20);
}

function allocateDurations({ segments, totalSeconds, introSeconds = 8.3, topicMeta = [] }) {
  if (!segments.length) return [];
  const safeTotal = Math.max(1, Number(totalSeconds) || 1);
  const bodySeconds = Math.max(1, safeTotal - Math.max(0, Number(introSeconds) || 0));
  const totalWords = Math.max(1, segments.reduce((sum, segment) => sum + Math.max(1, segment.words), 0));
  return segments.map((segment, index) => {
    const metadata = topicMeta.find((topic) => topic && topic.slug === segment.slug);
    return {
      ...segment,
      ...(metadata || defaultTopic(segment, index)),
      durationSeconds: bodySeconds * (Math.max(1, segment.words) / totalWords),
    };
  });
}

function buildScenePlan({ scriptText, totalSeconds, bumperSeconds = 8.3, topicMeta = [], imagesPerTopic = DEFAULT_IMAGES_PER_TOPIC }) {
  const segments = parseMarkedSegments(scriptText);
  if (!segments.length) throw new Error('Podcast script has no usable segments');
  const timed = allocateDurations({ segments, totalSeconds, introSeconds: bumperSeconds, topicMeta });
  const scenes = [];
  if (bumperSeconds > 0) scenes.push({ kind: 'cover', durationSeconds: bumperSeconds, label: 'Florida Buzz intro' });

  timed.forEach((segment, index) => {
    if (index === 0 || segment.slug === 'open') {
      const split = splitNamedOpen(segment);
      const words = Math.max(1, split.introWords + split.agendaWords);
      const introDuration = segment.durationSeconds * (Math.max(1, split.introWords) / words);
      scenes.push({ kind: 'cover', durationSeconds: introDuration, label: 'Geno welcome' });
      if (split.agendaWords > 0) {
        scenes.push({ kind: 'agenda', durationSeconds: Math.max(1, segment.durationSeconds - introDuration), label: 'Today’s topics' });
      }
      return;
    }

    if (/midroll|partner|close|outro/.test(segment.slug)) {
      scenes.push({ kind: 'brand', durationSeconds: segment.durationSeconds, label: segment.title, segmentSlug: segment.slug });
      return;
    }

    const prompts = Array.isArray(segment.prompts) ? segment.prompts.filter(Boolean) : [];
    const count = Math.max(1, Math.min(3, Number(imagesPerTopic) || DEFAULT_IMAGES_PER_TOPIC, prompts.length || DEFAULT_IMAGES_PER_TOPIC));
    for (let i = 0; i < count; i += 1) {
      const prompt = prompts[i] || `${segment.title}, Disney World editorial travel photograph, realistic Florida setting, no text or logos`;
      scenes.push({
        kind: 'topic',
        durationSeconds: segment.durationSeconds / count,
        label: segment.title,
        category: segment.category,
        prompt,
        visualKey: stableVisualKey(segment, prompt, i),
        segmentSlug: segment.slug,
      });
    }
  });
  return { scenes, topics: timed.filter((segment) => !/^(open|midroll|partner|close|outro)/.test(segment.slug)) };
}

module.exports = {
  DEFAULT_IMAGES_PER_TOPIC,
  allocateDurations,
  buildScenePlan,
  cleanTitle,
  parseMarkedSegments,
  plainSpeech,
  splitNamedOpen,
  stableVisualKey,
  wordCount,
};
