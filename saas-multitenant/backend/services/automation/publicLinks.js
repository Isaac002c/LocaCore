'use strict';

// =============================================================================
// publicLinks.js — Capability URLs assinadas para documentos do cliente (§8/§39).
//
// O recibo/NFS-e precisa chegar ao cliente por um link que ele consiga abrir sem
// login. Em vez de expor a rota autenticada, geramos um link com um token HMAC
// sobre (kind, tenant_id, id). Quem tem o link abre aquele documento — e só ele.
// A chave de assinatura é derivada da master key da aplicação (nunca a própria).
// Sem BASE_URL ou sem chave → não geramos link (o pipeline degrada com clareza).
// =============================================================================

const crypto = require('node:crypto');

function hmacKey() {
  const master = process.env.PUBLIC_LINK_SECRET || process.env.AUTOMATION_SECRETS_KEY || '';
  if (!master) return null;
  return crypto.createHash('sha256').update(`locacore-public-link|${master}`).digest();
}

function baseUrl() {
  return String(process.env.BASE_URL || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function sign(kind, tenant_id, id) {
  const key = hmacKey();
  if (!key || !tenant_id || !id) return null;
  return crypto.createHmac('sha256', key).update(`${kind}:${tenant_id}:${id}`).digest('hex').slice(0, 32);
}

function verify(kind, tenant_id, id, token) {
  const expected = sign(kind, tenant_id, id);
  if (!expected || !token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Link público do recibo. Retorna null se faltar BASE_URL/chave (fail-safe).
function receiptLink(tenant_id, receipt_id) {
  const token = sign('receipt', tenant_id, receipt_id);
  const base = baseUrl();
  if (!token || !base) return null;
  return `${base}/public/documents/receipt/${receipt_id}?tid=${encodeURIComponent(tenant_id)}&t=${token}`;
}

module.exports = { sign, verify, receiptLink, baseUrl, hmacKey };
