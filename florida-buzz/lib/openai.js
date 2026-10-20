// Thin wrapper around OpenAI's current image generation model.
// NOTE: DALL-E 3 was fully retired by OpenAI in May 2026 — gpt-image-1 is the
// current model. Unlike DALL-E, it always returns base64 image data directly
// rather than a temporary URL, which is actually simpler to work with.

async function generateImage(prompt, { quality = 'medium', size = '1536x1024' } = {}) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size,
      quality,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI image API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

/**
 * Generate from a real reference photograph via /v1/images/edits so architecture
 * and place layout stay honest for podcast YouTube stills.
 */
async function editImageFromReference(
  prompt,
  imageBuffer,
  {
    quality = 'high',
    size = '1536x1024',
    inputFidelity = 'high',
    mimeType = 'image/png',
  } = {}
) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error('editImageFromReference requires a reference image buffer');
  }
  const mime = String(mimeType || 'image/png').split(';')[0].trim().toLowerCase() || 'image/png';
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', String(prompt || '').slice(0, 32000));
  form.append('n', '1');
  form.append('size', size);
  form.append('quality', quality);
  form.append('input_fidelity', inputFidelity);
  form.append('image', new Blob([imageBuffer], { type: mime }), `reference.${ext}`);

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI image edit API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image edit API returned no image data');
  return Buffer.from(b64, 'base64');
}

module.exports = { generateImage, editImageFromReference };
