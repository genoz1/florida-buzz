// Thin wrapper around OpenAI's image generation API.

async function generateImage(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI image API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.data[0].url; // temporary URL, expires in about an hour
}

module.exports = { generateImage };
