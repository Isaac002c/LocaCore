// =============================================================================
// alertService.js — Alertas operacionais com cooldown/severidade/agrupamento (§20).
// Persiste em alert_log; envia por e-mail (mailService) respeitando um cooldown
// (não dispara o mesmo alerta indefinidamente). Tolerante à ausência da tabela.
// =============================================================================

const pool = require('../config/db');
const log = require('./logger');
let mailService = null;
try { mailService = require('./mailService'); } catch (_) { /* opcional */ }

// Cria/atualiza o alerta aberto (mesmo kind + tenant) e retorna se deve notificar.
async function raiseAlert(kind, { severity = 'warning', message = '', tenant_id = null, cooldownMinutes = 30 } = {}) {
  const now = new Date();
  let row;
  try {
    const existing = await pool.query(
      `SELECT * FROM alert_log WHERE kind=$1 AND (tenant_id = $2 OR (tenant_id IS NULL AND $2::uuid IS NULL)) AND resolved_at IS NULL ORDER BY last_at DESC LIMIT 1`,
      [kind, tenant_id]
    );
    if (existing.rows[0]) {
      row = (await pool.query(
        `UPDATE alert_log SET count=count+1, last_at=$2, message=$3, severity=$4 WHERE id=$1 RETURNING *`,
        [existing.rows[0].id, now.toISOString(), message, severity]
      )).rows[0];
    } else {
      row = (await pool.query(
        `INSERT INTO alert_log (tenant_id, kind, severity, message) VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenant_id, kind, severity, message]
      )).rows[0];
    }
  } catch (e) {
    log.warn('alert.persist_failed', { kind, error: e.message });
    return { notified: false };
  }

  const lastSent = row.last_sent_at ? new Date(row.last_sent_at).getTime() : 0;
  const cooled = now.getTime() - lastSent >= cooldownMinutes * 60000;
  log.warn('alert', { kind, severity, tenant_id, message, count: row.count });
  if (!cooled) return { notified: false, alert: row };

  // Notifica (best-effort) e registra o envio.
  if (mailService && process.env.ALERT_EMAIL_TO) {
    try {
      await mailService.sendMail({
        to: process.env.ALERT_EMAIL_TO,
        subject: `[LocaCore][${severity}] ${kind}`,
        text: `${message}\n\nOcorrências: ${row.count}\nTenant: ${tenant_id || '-'}\n`,
      });
    } catch (e) { log.warn('alert.email_failed', { kind, error: e.message }); }
  }
  try { await pool.query('UPDATE alert_log SET last_sent_at=$2 WHERE id=$1', [row.id, now.toISOString()]); } catch (_) { /* ignore */ }
  return { notified: true, alert: row };
}

async function resolveAlert(kind, tenant_id = null) {
  try { await pool.query(`UPDATE alert_log SET resolved_at=NOW() WHERE kind=$1 AND (tenant_id = $2 OR (tenant_id IS NULL AND $2::uuid IS NULL)) AND resolved_at IS NULL`, [kind, tenant_id]); }
  catch (_) { /* ignore */ }
}

module.exports = { raiseAlert, resolveAlert };
