// Thin wrapper around Pinterest's v5 API for creating pins.

async function createPin({ imageUrl, title, description, link }) {
  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PINTEREST_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      link,
      title,
      description,
      board_id: process.env.PINTEREST_BOARD_ID,
      media_source: {
        source_type: 'image_url',
        url: imageUrl,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pinterest API error ${res.status}: ${errText}`);
  }

  return res.json();
}

module.exports = { createPin };
