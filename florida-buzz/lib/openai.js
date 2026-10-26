// OpenAI retired gpt-image-1 on October 23, 2026.
// Preserve the existing prompts, quality, size, and base64 image contract.
const IMAGE_MODEL = 'gpt-image-2.5-sunburst';

async function generateImage(prompt, { quality = 'medium', size = '1536x1024' } = {}) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
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
    mimeType = 'image/png',
  } = {}
) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    throw new Error('editImageFromReference requires a reference image buffer');
  }
  const mime = String(mimeType || 'image/png').split(';')[0].trim().toLowerCase() || 'image/png';
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', String(prompt || '').slice(0, 32000));
  form.append('n', '1');
  form.append('size', size);
  form.append('quality', quality);
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
