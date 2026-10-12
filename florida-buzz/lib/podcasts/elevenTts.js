'use strict';

// Isolated ElevenLabs v4 solo TTS client for podcasts.
// Never call when PODCASTS_GENERATION_ENABLED is not true.
// Default production path: Geno Instant Voice Clone via text-to-speech.
//
// Audio tags: pass script text through with square-bracket cues intact
// ([conversational], [warmly], [chuckles], …). eleven_v3 / eleven_v4 read these as
// delivery directions. Do NOT strip [...] before the API call.
//
// Calm Geno recipe (anti-announcer): low stability, style 0, no speaker boost,
// slightly slower default speed; section speed varies by content heuristics.

const { formatScriptForTts } = require('./script');
const { pronunciationStyleInstructions } = require('./pronunciation');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/** Match ElevenLabs square-bracket audio tags. */
const AUDIO_TAG_RE = /\[[a-z][a-z0-9 ,'-]{0,40}\]/gi;

/**
 * Per-section speed (ElevenLabs 0.7–1.2). Longer/reflective → slower;
 * short punchy beats → a touch faster. Avoids one metronome pace.
 */
function pickSectionSpeed(text) {
  const raw = String(text || '');
  const words = raw
    .replace(AUDIO_TAG_RE, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (words > 0 && words <= 14) return 1.04;
  if (/\[nostalgic\]|\[sighs\]|\[warmly\]|\[thoughtful\]/i.test(raw)) return 0.91;
  if (words >= 90) return 0.92;
  if (/\?\s*$/m.test(raw) && words < 30) return 1.02;
  return 0.95;
}

function createElevenTts(cfg, fetcher = fetch) {
  function buildBody(text, { speed } = {}) {
    // `text` must retain ElevenLabs audio tags; no bracket-stripping here.
    const clampedSpeed = Math.max(0.7, Math.min(1.2, Number(speed) || 0.95));
    return {
      text,
      model_id: cfg.elevenModel,
      language_code: 'en',
      voice_settings: {
        // Calm / conversational — style 0 + no speaker boost = less radio polish
        stability: 0.3,
        similarity_boost: 0.55,
        style: 0,
        use_speaker_boost: false,
        speed: clampedSpeed,
      },
    };
  }

  async function synthesizeRaw(text, { speed, previousText, nextText } = {}) {
    if (!cfg.generation) throw new Error('Podcast audio generation is disabled');
    if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY is required for podcast TTS');
    if (!cfg.elevenVoiceGeno) throw new Error('PODCASTS_ELEVEN_VOICE_GENO is required');
    // Preserve [audio tags] verbatim — only trim outer whitespace.
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('ElevenLabs TTS text is empty');

    const resolvedSpeed = speed != null ? speed : pickSectionSpeed(trimmed);
    const url = `${TTS_URL}/${cfg.elevenVoiceGeno}?output_format=${encodeURIComponent(cfg.elevenOutputFormat || 'mp3_44100_128')}`;
    const headers = {
      'xi-api-key': cfg.elevenApiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    };

    let body = buildBody(trimmed, { speed: resolvedSpeed });
    if (previousText) body.previous_text = String(previousText).slice(-100);
    if (nextText) body.next_text = String(nextText).slice(0, 100);

    let response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Some eleven_v4 accounts reject voice_settings — retry bare body.
      if (response.status === 400 && /voice_settings|stability|style|speed/i.test(detail)) {
        body = {
          text: trimmed,
          model_id: cfg.elevenModel,
          language_code: 'en',
        };
        if (previousText) body.previous_text = String(previousText).slice(-100);
        if (nextText) body.next_text = String(nextText).slice(0, 100);
        response = await fetcher(url, {
          method: 'POST',
          redirect: 'error',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180000),
        });
        if (!response.ok) {
          const d2 = await response.text().catch(() => '');
          throw new Error(`ElevenLabs TTS ${response.status}: ${d2.slice(0, 400)}`);
        }
      } else {
        throw new Error(`ElevenLabs TTS ${response.status}: ${detail.slice(0, 400)}`);
      }
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('Empty ElevenLabs audio download');
    return {
      buffer,
      requestId: response.headers.get('request-id') || null,
      model: cfg.elevenModel,
      voiceId: cfg.elevenVoiceGeno,
      speed: resolvedSpeed,
      styleNote: pronunciationStyleInstructions(),
    };
  }

  return {
    formatSection(sectionText) {
      return formatScriptForTts(sectionText, { keepSpeakerPrefix: false });
    },
    pickSectionSpeed,
    async synthesize(sectionText, opts = {}) {
      const text = this.formatSection(sectionText);
      return synthesizeRaw(text, {
        speed: opts.speed != null ? opts.speed : pickSectionSpeed(text),
        previousText: opts.previousText,
        nextText: opts.nextText,
      });
    },
    async synthesizeText(text, opts = {}) {
      return synthesizeRaw(text, opts);
    },
  };
}

module.exports = { createElevenTts, TTS_URL, pickSectionSpeed };
