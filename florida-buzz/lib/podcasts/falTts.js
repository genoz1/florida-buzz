'use strict';

// Isolated fal Gemini TTS client for podcasts (optional fallback).
// Never call when PODCASTS_GENERATION_ENABLED is not true.
// Production default is ElevenLabs solo Geno; set PODCASTS_TTS_PROVIDER=fal to use this path.

const { pronunciationStyleInstructions } = require('./pronunciation');
const { formatScriptForTts } = require('./script');

function queueUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'queue.fal.run' || url.username || url.password) {
    throw new Error('Unexpected fal queue URL');
  }
  return url.href;
}

function createFalTts(cfg, fetcher = fetch) {
  async function json(url, method = 'GET', body) {
    const response = await fetcher(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Key ${cfg.falKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        /* ignore */
      }
      throw new Error(`fal TTS ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ''}`);
    }
    return response.json();
  }

  function buildInput(prompt) {
    const soloPrompt = formatScriptForTts(prompt, { keepSpeakerPrefix: false });
    return {
      prompt: soloPrompt,
      model: cfg.falModel,
      language_code: cfg.languageCode,
      temperature: cfg.temperature,
      output_format: cfg.outputFormat,
      voice: cfg.falSoloVoice || cfg.genaVoice || 'Aoede',
      style_instructions: [
        'Solo casual Central Florida park-day host (Geno) — calm dad-talk, warm, conversational. Been going to Walt Disney World since eighteen months old / over fifty years ago — never state age in years, never say unofficial. Never cartoon, never robotic AI assistant, never dual-host banter, never radio announcer polish. Named welcome first (I\'m Geno / Florida Buzz: Disney / eighteen months / fifty years / Let\'s go), then quick hits, one deep dive, CTA. Longer breath groups, uneven pacing, micro-pauses. Less announcer, more real conversation.',
        pronunciationStyleInstructions(),
      ].join(' '),
    };
  }

  return {
    buildInput,
    async submit(prompt) {
      if (!cfg.generation) throw new Error('Podcast audio generation is disabled');
      if (!cfg.falKey) throw new Error('FAL_KEY is required for podcast TTS');
      const input = buildInput(prompt);
      const result = await json(`https://queue.fal.run/${cfg.falEndpoint}`, 'POST', input);
      if (!result.request_id) throw new Error('Missing fal request ID; do not resubmit');
      return {
        request_id: result.request_id,
        status_url: queueUrl(result.status_url),
        response_url: queueUrl(result.response_url),
        endpoint: cfg.falEndpoint,
        model: cfg.falModel,
        input,
      };
    },
    async status(job) {
      return json(job.status_url, 'GET');
    },
    async result(job) {
      return json(job.response_url, 'GET');
    },
    async downloadAudio(audioUrl) {
      const url = new URL(audioUrl);
      if (url.protocol !== 'https:') throw new Error('Audio URL must be https');
      const response = await fetcher(url.href, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Failed to download fal audio (${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) throw new Error('Empty fal audio download');
      return buffer;
    },
  };
}

module.exports = { createFalTts, queueUrl };
