/**
 * Sponsor applications — persist inquiries/logos and start Stripe Checkout
 * when annual price IDs are configured.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getTier, formatUsdFromCents, stripeConfigured, stripePriceEnvKey } = require('./sponsors');

const DATA_DIR = path.join(__dirname, '..', 'data', 'sponsor-applications');
const LOGO_DIR = path.join(__dirname, '..', 'public', 'images', 'sponsors', 'applications');

const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOGO_DIR, { recursive: true });
}

function sanitizeFilename(name) {
  return String(name || 'logo')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'logo';
}

function extForMime(mime) {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '';
  }
}

function validateApplication(body, file) {
  const errors = [];
  const companyName = String(body.company_name || '').trim();
  const contactName = String(body.contact_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const website = String(body.website_url || '').trim();
  const description = String(body.description || '').trim();
  const tierId = String(body.tier_id || '').trim();
  const phone = String(body.phone || '').trim();

  if (!companyName || companyName.length < 2) errors.push('Enter your company or brand name.');
  if (!contactName || contactName.length < 2) errors.push('Enter a contact name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');
  if (!website) {
    errors.push('Enter your website URL.');
  } else {
    try {
      const u = new URL(website.startsWith('http') ? website : `https://${website}`);
      if (!['http:', 'https:'].includes(u.protocol)) errors.push('Website must be an http(s) URL.');
    } catch {
      errors.push('Enter a valid website URL.');
    }
  }
  if (!description || description.length < 20) {
    errors.push('Add a listing description (at least a short paragraph).');
  }
  if (description.length > 600) errors.push('Keep the listing description under 600 characters.');
  if (!getTier(tierId)) errors.push('Choose a sponsorship tier.');

  if (!file || !file.buffer) {
    errors.push('Upload a logo (PNG, JPG, WebP, or SVG).');
  } else if (!ALLOWED_LOGO_TYPES.has(file.mimetype)) {
    errors.push('Logo must be PNG, JPG, WebP, or SVG.');
  }

  return {
    errors,
    values: {
      companyName,
      contactName,
      email,
      website: website.startsWith('http') ? website : `https://${website}`,
      description,
      tierId,
      phone,
    },
  };
}

function saveLogo(file, applicationId) {
  ensureDirs();
  const ext = extForMime(file.mimetype) || path.extname(file.originalname || '') || '.png';
  const filename = `${applicationId}-${sanitizeFilename(path.parse(file.originalname || 'logo').name)}${ext}`;
  const abs = path.join(LOGO_DIR, filename);
  fs.writeFileSync(abs, file.buffer);
  return {
    filename,
    publicPath: `/images/sponsors/applications/${filename}`,
    absPath: abs,
  };
}

function persistApplication(record) {
  ensureDirs();
  const filePath = path.join(DATA_DIR, `${record.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
  return filePath;
}

async function notifyTeam(record) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'no_resend' };
  const tier = getTier(record.tierId);
  const { sendEmail } = require('./resend');
  const to = process.env.SPONSOR_NOTIFY_EMAIL || 'floridabuzzonline@gmail.com';
  const html = `
    <p>New Florida Buzz sponsor application</p>
    <ul>
      <li><strong>Company:</strong> ${escapeHtml(record.companyName)}</li>
      <li><strong>Contact:</strong> ${escapeHtml(record.contactName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(record.email)}</li>
      <li><strong>Phone:</strong> ${escapeHtml(record.phone || '—')}</li>
      <li><strong>Website:</strong> ${escapeHtml(record.website)}</li>
      <li><strong>Tier:</strong> ${escapeHtml(tier ? tier.name : record.tierId)} (${escapeHtml(formatUsdFromCents(tier?.annualCents || 0))} / year)</li>
      <li><strong>Payment:</strong> ${escapeHtml(record.paymentStatus)}</li>
      <li><strong>Logo:</strong> ${escapeHtml(record.logoPublicPath || '—')}</li>
    </ul>
    <p><strong>Listing description</strong></p>
    <p>${escapeHtml(record.description)}</p>
  `;
  await sendEmail({
    to,
    subject: `Sponsor application: ${record.companyName} (${tier?.name || record.tierId})`,
    html,
  });
  return { sent: true };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function createStripeCheckout({ record, env = process.env, siteUrl }) {
  if (!stripeConfigured(env)) {
    return { ok: false, reason: 'stripe_not_ready' };
  }
  const priceId = env[stripePriceEnvKey(record.tierId)];
  const Stripe = require('stripe');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const base = (siteUrl || env.SITE_URL || 'https://thefloridabuzz.com').replace(/\/$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: record.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/sponsors/become/success?application=${encodeURIComponent(record.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/sponsors/become?canceled=1&application=${encodeURIComponent(record.id)}#apply`,
    metadata: {
      application_id: record.id,
      tier_id: record.tierId,
      company_name: record.companyName.slice(0, 400),
    },
  });
  return { ok: true, url: session.url, sessionId: session.id };
}

async function submitApplication({ body, file, env = process.env, siteUrl }) {
  // Honeypot
  if (body.company_website && String(body.company_website).trim()) {
    return { ok: true, spam: true };
  }
  const renderedAt = parseInt(body.form_rendered_at, 10) || 0;
  if (renderedAt && Date.now() - renderedAt < 1500) {
    return { ok: true, spam: true };
  }

  const { errors, values } = validateApplication(body, file);
  if (errors.length) return { ok: false, errors, values };

  const id = crypto.randomUUID();
  const logo = saveLogo(file, id);
  const tier = getTier(values.tierId);
  const record = {
    id,
    createdAt: new Date().toISOString(),
    ...values,
    tierName: tier.name,
    annualCents: tier.annualCents,
    logoPublicPath: logo.publicPath,
    logoFilename: logo.filename,
    paymentStatus: stripeConfigured(env) ? 'checkout_pending' : 'awaiting_stripe_setup',
    stripeSessionId: null,
  };

  persistApplication(record);
  try {
    await notifyTeam(record);
  } catch (err) {
    console.error('[sponsors] notify failed:', err.message);
  }

  const checkout = await createStripeCheckout({ record, env, siteUrl });
  if (checkout.ok) {
    record.stripeSessionId = checkout.sessionId;
    record.paymentStatus = 'checkout_started';
    persistApplication(record);
    return { ok: true, record, checkoutUrl: checkout.url };
  }

  return {
    ok: true,
    record,
    checkoutUrl: null,
    stripePending: true,
  };
}

module.exports = {
  validateApplication,
  submitApplication,
  createStripeCheckout,
  persistApplication,
  DATA_DIR,
  LOGO_DIR,
  ALLOWED_LOGO_TYPES,
};
