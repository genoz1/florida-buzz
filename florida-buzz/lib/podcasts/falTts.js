'use strict';

// Isolated fal Gemini TTS client for podcasts.
// Never call when PODCASTS_GENERATION_ENABLED is not true.
// Does not share request allowlists with lib/reels/fal.js.

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
    return {
      prompt,
      model: cfg.falModel,
      language_code: cfg.languageCode,
      temperature: cfg.temperature,
      output_format: cfg.outputFormat,
      style_instructions:
        'Lively, warm US English conversation between two Central Florida moms who are longtime friends — aftershow/reaction energy, not stiff radio presenters. Upbeat pacing, short reactive turns, soft laughs, brief overlaps and excited affirmations OK. Sound engaged and fun, not chaotic or shouty. No cartoon voices, no heavy accents, no announcer cadence. The host name Gena is spelled G-E-N-A but must be pronounced like Gina (JEEN-uh), never Jenna or Gee-nuh.',
      speakers: [
        { speaker_id: 'Gena', voice: cfg.genaVoice },
        { speaker_id: 'Diane', voice: cfg.dianeVoice },
      ],
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
