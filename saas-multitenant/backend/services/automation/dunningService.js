// =============================================================================
// dunningService.js — Régua de inadimplência. Enfileira lembretes (1/dia por
// padrão) para cobranças em aberto, respeitando o limite e parando quando a
// cobrança é paga/cancelada ou a locação é encerrada. Idempotente por dia.
// =============================================================================

const M = require('../../models/automationModels');
const { render, buildVars } = require('./render');
const { zonedParts } = require('./timezone');

async function runDunning(tenant_id, { now = new Date() } = {}) {
  const settings = await M.getSettings(tenant_id) || {};
  if (settings.automation_mode !== undefined && !['pilot', 'staged', 'global'].includes(settings.automation_mode)) return { skipped: 'automation_not_active' };
  if (!settings.whatsapp_enabled || Number(settings.reminder_max || 0) <= 0) return { skipped: 'disabled' };

  const template = await M.getActiveTemplate(tenant_id, 'reminder');
  const charges = await M.listOpenChargesForDunning(tenant_id);
  const day = zonedParts(now, settings.billing_timezone || 'America/Sao_Paulo').ymd;
  let enqueued = 0, skipped = 0;

  for (const c of charges) {
    if (c.status === 'waiting_payment' && c.due_date && String(c.due_date).slice(0, 10) < day) {
      await M.updateCharge(c.id, tenant_id, { status: 'overdue' });
      c.status = 'overdue';
    }
    if (['finalizado', 'cancelado'].includes(c.rental_status)) { skipped++; continue; }
    if (!c.client_phone) { skipped++; continue; }
    const sent = await M.countRemindersForCharge(tenant_id, c.id);
    if (sent >= Number(settings.reminder_max)) { skipped++; continue; }

    const last = await M.getLastReminderForCharge(tenant_id, c.id);
    const intervalMs = Math.max(1, Number(settings.reminder_interval_hours || 24)) * 3600000;
    if (last?.created_at && now.getTime() - new Date(last.created_at).getTime() < intervalMs) { skipped++; continue; }

    const vars = buildVars({ rental: { rental_number: c.rental_number, client_name: c.client_name }, charge: c });
    const body = template ? render(template.body, vars).text : `Lembrete: cobrança da locação ${c.rental_number} em aberto (${vars.valor}).`;
    const res = await M.insertOutbox({
      tenant_id, client_id: c.client_id, rental_id: c.rental_id, charge_id: c.id,
      template_kind: 'reminder', to_number: c.client_phone, body, payload: vars,
      idempotency_key: `${c.id}:reminder:${day}`,
    });
    if (res.created) enqueued++; else skipped++;    // idempotente por dia (sem duplicar)
  }
  return { ok: true, enqueued, skipped };
}

module.exports = { runDunning };
