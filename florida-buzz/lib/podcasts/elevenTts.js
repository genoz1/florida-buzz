'use strict';

// Isolated ElevenLabs v4 solo TTS client for podcasts.
// Never call when PODCASTS_GENERATION_ENABLED is not true.
// Default production path: Geno Instant Voice Clone via text-to-speech.

const { formatScriptForTts } = require('./script');
const { pronunciationStyleInstructions } = require('./pronunciation');

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

function createElevenTts(cfg, fetcher = fetch) {
  function buildBody(text) {
    return {
      text,
      model_id: cfg.elevenModel,
      language_code: 'en',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.35,
        use_speaker_boost: true,
      },
    };
  }

  async function synthesizeRaw(text) {
    if (!cfg.generation) throw new Error('Podcast audio generation is disabled');
    if (!cfg.elevenApiKey) throw new Error('ELEVENLABS_API_KEY is required for podcast TTS');
    if (!cfg.elevenVoiceGeno) throw new Error('PODCASTS_ELEVEN_VOICE_GENO is required');
    const trimmed = String(text || '').trim();
    if (!trimmed) throw new Error('ElevenLabs TTS text is empty');

    const url = `${TTS_URL}/${cfg.elevenVoiceGeno}?output_format=${encodeURIComponent(cfg.elevenOutputFormat || 'mp3_44100_128')}`;
    const headers = {
      'xi-api-key': cfg.elevenApiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    };

    let body = buildBody(trimmed);
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
      if (response.status === 400 && /voice_settings|stability|style/i.test(detail)) {
        body = {
          text: trimmed,
          model_id: cfg.elevenModel,
          language_code: 'en',
        };
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
      styleNote: pronunciationStyleInstructions(),
    };
  }

  return {
    formatSection(sectionText) {
      return formatScriptForTts(sectionText, { keepSpeakerPrefix: false });
    },
    async synthesize(sectionText) {
      const text = this.formatSection(sectionText);
      return synthesizeRaw(text);
    },
    async synthesizeText(text) {
      return synthesizeRaw(text);
    },
  };
}

module.exports = { createElevenTts, TTS_URL };
