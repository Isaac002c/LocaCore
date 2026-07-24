// =============================================================================
// dunningService.js — Régua de inadimplência. Enfileira lembretes (1/dia por
// padrão) para cobranças em aberto, respeitando o limite e parando quando a
// cobrança é paga/cancelada ou a locação é encerrada. Idempotente por dia.
// =============================================================================

const M = require('../../models/automationModels');
const { render, buildVars } = require('./render');

const ymd = (d) => d.toISOString().substring(0, 10);

async function runDunning(tenant_id, { now = new Date() } = {}) {
  const settings = await M.getSettings(tenant_id) || {};
  if (!settings.whatsapp_enabled || Number(settings.reminder_max || 0) <= 0) return { skipped: 'disabled' };

  const template = await M.getActiveTemplate(tenant_id, 'reminder');
  const charges = await M.listOpenChargesForDunning(tenant_id);
  const day = ymd(now);
  let enqueued = 0, skipped = 0;

  for (const c of charges) {
    if (['finalizado', 'cancelado'].includes(c.rental_status)) { skipped++; continue; }
    if (!c.client_phone) { skipped++; continue; }
    const sent = await M.countRemindersForCharge(tenant_id, c.id);
    if (sent >= Number(settings.reminder_max)) { skipped++; continue; }

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
