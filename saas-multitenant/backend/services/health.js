// =============================================================================
// health.js — Verificações de saúde para /health/live e /health/ready (§19).
// Não expõe detalhes sensíveis. Readiness é gated pelo banco; worker/scheduler
// entram como informativo (a API serve mesmo com o worker fora — mas sinaliza).
// =============================================================================

const pool = require('../config/db');

async function checkDb() {
  try { await pool.query('SELECT 1'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

async function heartbeatFresh(service, maxAgeSeconds = 180) {
  try {
    const r = await pool.query('SELECT last_beat FROM system_heartbeats WHERE service = $1', [service]);
    if (!r.rows[0]) return { ok: false, reason: 'no_heartbeat' };
    const age = Math.round((Date.now() - new Date(r.rows[0].last_beat).getTime()) / 1000);
    return { ok: age <= maxAgeSeconds, age_seconds: age };
  } catch (e) { return { ok: false, reason: 'unavailable' }; }
}

async function outboxBacklog() {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM message_outbox WHERE status IN ('pending','failed')`);
    return { ok: true, pending: r.rows[0].n };
  } catch (e) { return { ok: false, reason: 'unavailable' }; }
}

async function ready() {
  const [db, worker, scheduler, outbox] = await Promise.all([
    checkDb(), heartbeatFresh('worker'), heartbeatFresh('scheduler'), outboxBacklog(),
  ]);
  // Readiness "duro" = banco. Worker/scheduler são informativos/degradação.
  return { ok: db.ok, checks: { db, worker, scheduler, outbox } };
}

module.exports = { checkDb, heartbeatFresh, outboxBacklog, ready };
