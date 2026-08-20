'use strict';

const pool = require('../../config/db');

const SAFE_DETAIL_KEYS = new Set([
  'reason', 'source', 'mode', 'rental_number', 'public_id', 'provider_status',
  'http_status', 'duplicate', 'skipped', 'template_kind', 'document_type',
]);

function sanitizeDetails(details = {}) {
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return out;
}

async function record(data = {}, db = pool) {
  if (!data.tenant_id || !data.event_type || !data.status) return null;
  try {
    const r = await db.query(
      `INSERT INTO automation_audit_log
       (tenant_id,event_type,status,client_id,rental_id,charge_id,billing_id,payment_id,
        fiscal_document_id,amount,period_start,period_end,provider,request_id,correlation_id,
        attempt,error_code,error_message,details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
       RETURNING *`,
      [
        data.tenant_id, data.event_type, data.status,
        data.client_id || null, data.rental_id || null, data.charge_id || null,
        data.billing_id || null, data.payment_id || null, data.fiscal_document_id || null,
        data.amount == null ? null : Number(data.amount).toFixed(2),
        data.period_start || null, data.period_end || null, data.provider || null,
        data.request_id || null, data.correlation_id || null, Number(data.attempt || 0),
        data.error_code || null,
        data.error_message ? String(data.error_message).slice(0, 1000) : null,
        JSON.stringify(sanitizeDetails(data.details)),
      ],
    );
    return r.rows[0];
  } catch (_) {
    // Auditoria nao deve derrubar o fluxo; health/readiness denuncia migration ausente.
    return null;
  }
}

async function list(tenant_id, { limit = 100, charge_id = null } = {}) {
  const params = [tenant_id];
  let where = 'WHERE tenant_id=$1';
  if (charge_id) { params.push(charge_id); where += ` AND charge_id=$${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 500));
  const r = await pool.query(
    `SELECT * FROM automation_audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

module.exports = { record, list, sanitizeDetails };

