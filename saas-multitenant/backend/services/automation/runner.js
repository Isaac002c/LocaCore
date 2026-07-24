// =============================================================================
// runner.js — Orquestra os jobs de automação por TODOS os tenants elegíveis.
// Usado pelo worker e pelo scheduler. Cada job por-tenant já é idempotente.
// =============================================================================

const pool = require('../../config/db');
const billing = require('./billingCycleService');
const dunning = require('./dunningService');
const outbox = require('./outboxService');
const fiscal = require('./fiscalService');
const rentalModel = require('../../models/rentalModels');

const tenantsWith = async (flagColumn) => {
  const r = await pool.query(`SELECT tenant_id FROM automation_settings WHERE ${flagColumn} = TRUE`);
  return r.rows.map((x) => x.tenant_id);
};
const billingTenants = async () => {
  const r = await pool.query('SELECT tenant_id, billing_weekday, billing_hour FROM automation_settings WHERE billing_enabled = TRUE');
  return r.rows;
};
const rentalTenants = async () => {
  const r = await pool.query('SELECT DISTINCT tenant_id FROM rentals');
  return r.rows.map((x) => x.tenant_id);
};

// Heartbeat de liveness (worker/scheduler) — lido por /health/ready.
async function heartbeat(service, meta = {}) {
  const now = new Date().toISOString();
  const upd = await pool.query('UPDATE system_heartbeats SET last_beat=$2, meta=$3::jsonb WHERE service=$1 RETURNING service', [service, now, JSON.stringify(meta)]);
  if (!upd.rows.length) {
    await pool.query('INSERT INTO system_heartbeats (service, last_beat, meta) VALUES ($1,$2,$3::jsonb)', [service, now, JSON.stringify(meta)]).catch(() => {});
  }
}

async function processOutboxAll({ limit = 50 } = {}) {
  const tenants = await tenantsWith('whatsapp_enabled');
  let sent = 0, failed = 0, skipped = 0;
  for (const t of tenants) {
    const r = await outbox.process(t, { limit }).catch(() => ({ sent: 0, failed: 0, skipped: 0 }));
    sent += r.sent || 0; failed += r.failed || 0; skipped += r.skipped || 0;
  }
  return { tenants: tenants.length, sent, failed, skipped };
}

// Cobrança semanal: só roda no dia/hora configurados por tenant (idempotente/semana).
async function runBillingAll({ now = new Date() } = {}) {
  const rows = await billingTenants();
  const res = [];
  for (const s of rows) {
    if (Number(s.billing_weekday) !== now.getDay()) continue;
    if (now.getHours() < Number(s.billing_hour)) continue;
    res.push({ tenant: s.tenant_id, ...(await billing.runBilling(s.tenant_id, { now }).catch((e) => ({ error: e.message }))) });
  }
  return res;
}

async function runDunningAll({ now = new Date() } = {}) {
  const tenants = await tenantsWith('whatsapp_enabled');
  const res = [];
  for (const t of tenants) res.push({ tenant: t, ...(await dunning.runDunning(t, { now }).catch((e) => ({ error: e.message }))) });
  return res;
}

async function flagOverdueAll() {
  const tenants = await rentalTenants();
  let flagged = 0;
  for (const t of tenants) flagged += await rentalModel.flagOverdue(t).catch(() => 0);
  return { tenants: tenants.length, flagged };
}

async function fiscalBatchAll() {
  const tenants = await tenantsWith('fiscal_enabled');
  const res = [];
  for (const t of tenants) res.push({ tenant: t, ...(await fiscal.runBatch(t, {}).catch((e) => ({ error: e.message }))) });
  return res;
}

module.exports = { heartbeat, processOutboxAll, runBillingAll, runDunningAll, flagOverdueAll, fiscalBatchAll, tenantsWith };
