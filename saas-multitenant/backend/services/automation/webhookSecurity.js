// =============================================================================
// webhookSecurity.js — Verificação de assinatura/replay de webhooks (§11).
// Trabalha sobre o CORPO BRUTO (Buffer/string), nunca sobre o JSON já parseado.
// =============================================================================

const crypto = require('crypto');

const toBuf = (raw) => (Buffer.isBuffer(raw) ? raw : Buffer.from(raw == null ? '' : String(raw), 'utf8'));

function hmacSha256Hex(raw, secret) {
  return crypto.createHmac('sha256', secret).update(toBuf(raw)).digest('hex');
}

// Comparação em tempo constante (evita timing attack).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

// Valida HMAC-SHA256 hex (opcionalmente prefixado, ex.: "sha256=..."), sobre o raw.
function verifyHmacSignature(raw, headerValue, secret) {
  if (!secret || !headerValue) return false;
  const provided = String(headerValue).replace(/^sha256=/i, '').trim();
  const expected = hmacSha256Hex(raw, secret);
  return safeEqual(provided, expected);
}

// Frescor do timestamp (anti-replay por janela). ts em segundos ou ms.
function timestampFresh(ts, maxSkewSeconds = 300, now = Date.now()) {
  if (!ts) return false;
  let t = Number(ts);
  if (!Number.isFinite(t)) return false;
  if (t < 1e12) t *= 1000; // segundos → ms
  return Math.abs(now - t) <= maxSkewSeconds * 1000;
}

module.exports = { hmacSha256Hex, safeEqual, verifyHmacSignature, timestampFresh, toBuf };
