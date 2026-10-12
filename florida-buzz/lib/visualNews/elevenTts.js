'use strict';

/**
 * Direct ElevenLabs TTS for visual news (eleven_v4 by default).
 * Calls api.elevenlabs.io — never fal.ai / FAL_KEY.
 */

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

async function synthesizeElevenV4({
  apiKey,
  voiceId,
  modelId = 'eleven_v4',
  text,
  outputFormat = 'mp3_44100_128',
  fetcher = fetch,
}) {
  const trimmed = String(text || '').trim();
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required for visual news TTS');
  if (!voiceId) throw new Error('ElevenLabs voice id is required');
  if (!trimmed) throw new Error('ElevenLabs TTS text is empty');

  const url = `${TTS_URL}/${voiceId}?output_format=${encodeURIComponent(outputFormat)}`;
  const headers = {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };

  let body = {
    text: trimmed,
    model_id: modelId,
    language_code: 'en',
    voice_settings: {
      stability: 0.4,
      similarity_boost: 0.72,
      style: 0.5,
      use_speaker_boost: true,
    },
  };

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
      body = { text: trimmed, model_id: modelId, language_code: 'en' };
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
    model: modelId,
    voiceId,
    provider: 'elevenlabs-direct',
  };
}

module.exports = { synthesizeElevenV4, TTS_URL };
