// Thin wrapper around OpenAI's current image generation model.
// NOTE: DALL-E 3 was fully retired by OpenAI in May 2026 — gpt-image-1 is the
// current model. Unlike DALL-E, it always returns base64 image data directly
// rather than a temporary URL, which is actually simpler to work with.

async function generateImage(prompt) {
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
      size: '1536x1024',
      quality: 'medium',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI image API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return Buffer.from(data.data[0].b64_json, 'base64');
}

module.exports = { generateImage };
