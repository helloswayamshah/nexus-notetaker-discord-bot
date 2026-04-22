const crypto = require('node:crypto');

// AES-256-GCM, random 12-byte IV per encryption, authenticated via the
// 16-byte GCM tag. Encoded output shape:
//   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
//
// The version prefix lets us detect already-encrypted values on read, and
// lets us swap algorithms later without breaking data already in SQLite.

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;

  const trimmed = raw.trim();
  // Accept base64 (44 chars with '=') or hex (64 chars) — both give 32 bytes.
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buf = Buffer.from(trimmed, 'hex');
  } else {
    try {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length === KEY_BYTES) buf = decoded;
    } catch {
      /* fall through */
    }
  }
  if (!buf || buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (either 64-char hex or 44-char base64). `
      + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  cachedKey = buf;
  return cachedKey;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const key = loadKey();
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not set — refusing to store a user-provided secret in plaintext. '
      + 'Set ENCRYPTION_KEY in your environment / .env and try again.'
    );
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(encoded) {
  if (encoded == null || encoded === '') return encoded;
  if (!isEncrypted(encoded)) {
    // Legacy plaintext value — return as-is. Caller logs a warning.
    return encoded;
  }
  const key = loadKey();
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY is not set but an encrypted value was found in the DB. '
      + 'Set the same ENCRYPTION_KEY that was used to encrypt it, or reset the value via /config.'
    );
  }
  const parts = encoded.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted value — expected 4 colon-delimited parts.');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function isKeyConfigured() {
  return !!loadKey();
}

module.exports = { encrypt, decrypt, isEncrypted, isKeyConfigured };
