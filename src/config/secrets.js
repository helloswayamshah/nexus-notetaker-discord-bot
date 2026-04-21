const fs = require('node:fs');
const path = require('node:path');

const SECRETS_DIR = process.env.SECRETS_DIR || '/run/secrets';

// Read a secret value. Priority:
//   1. File at $SECRETS_DIR/<name> (Docker secrets, Kubernetes secrets,
//      Vault-agent tmpfs, etc. — never leaks via `env` or `ps`).
//   2. Environment variable $envFallback (for local dev + legacy).
// Trims trailing whitespace / newlines that secrets-file writers often add.
function readSecret(name, envFallback) {
  const filePath = path.join(SECRETS_DIR, name);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const value = raw.replace(/\s+$/u, '');
    if (value) return value;
  } catch {
    // fall through to env
  }
  const envName = envFallback || name.toUpperCase();
  return process.env[envName] || '';
}

module.exports = { readSecret, SECRETS_DIR };
