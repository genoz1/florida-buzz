const crypto = require('crypto');

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function keyedHash(key, value) {
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptJson(key, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte encryption key is required.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptJson(key, value) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A 32-byte encryption key is required.');
  const [version, ivValue, tagValue, ciphertextValue] = String(value).split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error('Encrypted value is malformed.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

module.exports = { constantTimeEqual, decryptJson, encryptJson, keyedHash, randomToken, sha256 };
