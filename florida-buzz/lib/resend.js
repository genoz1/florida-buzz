// Thin wrapper around Resend's email API.

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.NEWSLETTER_FROM_EMAIL || 'Florida Buzz <newsletter@thefloridabuzz.com>',
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error ${res.status}: ${errText}`);
  }

  return res.json();
}

module.exports = { sendEmail };
