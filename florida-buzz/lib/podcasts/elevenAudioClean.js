'use strict';

/**
 * ElevenLabs Voice Isolator — clean a human Geno recording.
 * Removes background noise / room tone while keeping the real voice.
 * POST /v1/audio-isolation (multipart). Requires ELEVENLABS_API_KEY.
 */

const ISOLATION_URL = 'https://api.elevenlabs.io/v1/audio-isolation';

async function isolateSpeech(audioBuffer, { apiKey, filename = 'recording.mp3', fetcher = fetch } = {}) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required to clean recordings');
  const buf = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  if (!buf.length) throw new Error('Recording is empty');

  const form = new FormData();
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  form.append('audio', blob, filename || 'recording.mp3');
  form.append('file_format', 'other');

  const res = await fetcher(ISOLATION_URL, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs audio isolation ${res.status}: ${detail.slice(0, 400)}`);
  }
  const out = Buffer.from(await res.arrayBuffer());
  if (!out.length) throw new Error('ElevenLabs audio isolation returned empty audio');
  return {
    buffer: out,
    requestId: res.headers.get('request-id') || null,
  };
}

module.exports = { isolateSpeech, ISOLATION_URL };
