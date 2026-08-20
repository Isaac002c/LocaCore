'use strict';

const crypto = require('node:crypto');
const pool = require('../../config/db');
const { getSecret: getEnvSecret } = require('./secrets');

function masterKey() {
  const raw = process.env.AUTOMATION_SECRETS_KEY;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  } catch (_) { /* ignore */ }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptionReady() { return !!masterKey(); }

function encrypt(value) {
  const key = masterKey();
  if (!key) throw new Error('AUTOMATION_SECRETS_KEY nao configurada.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(value), 'utf8')), cipher.final()]);
  return { ciphertext, iv, auth_tag: cipher.getAuthTag() };
}

function decrypt(row) {
  const key = masterKey();
  if (!key) throw new Error('AUTOMATION_SECRETS_KEY nao configurada.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, row.iv);
  decipher.setAuthTag(row.auth_tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
}

async function setSecrets(tenant_id, scope, values = {}, db = pool) {
  if (!encryptionReady()) throw new Error('Armazenamento seguro indisponivel: configure AUTOMATION_SECRETS_KEY.');
  const saved = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const enc = encrypt(value);
    await db.query(
      `INSERT INTO tenant_integration_secrets
       (tenant_id,scope,secret_name,ciphertext,iv,auth_tag)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,scope,secret_name) DO UPDATE SET
         ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, auth_tag=EXCLUDED.auth_tag, updated_at=NOW()`,
      [tenant_id, scope, name, enc.ciphertext, enc.iv, enc.auth_tag],
    );
    saved.push(name);
  }
  return saved;
}

async function removeSecret(tenant_id, scope, name, db = pool) {
  const r = await db.query(
    'DELETE FROM tenant_integration_secrets WHERE tenant_id=$1 AND scope=$2 AND secret_name=$3',
    [tenant_id, scope, name],
  );
  return r.rowCount > 0;
}

async function getSecrets(tenant_id, scope, db = pool) {
  if (!encryptionReady()) return {};
  let rows = [];
  try {
    rows = (await db.query(
      'SELECT secret_name,ciphertext,iv,auth_tag FROM tenant_integration_secrets WHERE tenant_id=$1 AND scope=$2',
      [tenant_id, scope],
    )).rows;
  } catch (_) { return {}; }
  const out = {};
  for (const row of rows) {
    try { out[row.secret_name] = decrypt(row); } catch (_) { /* readiness mostrara corrompido/ausente */ }
  }
  return out;
}

async function secretPresence(tenant_id, scope, db = pool) {
  try {
    const r = await db.query(
      'SELECT secret_name FROM tenant_integration_secrets WHERE tenant_id=$1 AND scope=$2 ORDER BY secret_name',
      [tenant_id, scope],
    );
    return r.rows.map((row) => row.secret_name);
  } catch (_) { return []; }
}

function resolver(values = {}, tenantSlug = null) {
  return (scope, name) => {
    const candidates = [
      name, String(name).toLowerCase(), `${scope}_${name}`, `${scope}_${name}`.toLowerCase(),
    ];
    for (const key of candidates) if (values[key]) return values[key];
    return getEnvSecret(scope, name, tenantSlug);
  };
}

module.exports = {
  masterKey, encryptionReady, encrypt, decrypt, setSecrets, removeSecret,
  getSecrets, secretPresence, resolver,
};

