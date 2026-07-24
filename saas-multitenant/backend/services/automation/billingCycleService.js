// =============================================================================
// billingCycleService.js — Job de cobrança semanal (idempotente por semana).
// Para cada locação elegível: cria faturamento (reusa o financeiro real), gera a
// cobrança (PaymentProvider) e enfileira a mensagem (outbox). Uma cobrança por
// locação/semana — a chave de idempotência impede duplicidade mesmo em reexecução.
// =============================================================================

const M = require('../../models/automationModels');
const billingModel = require('../../models/serviceBillingModels');
const rentalModel = require('../../models/rentalModels');
const { getPaymentProvider } = require('./providers/payment');
const { render, buildVars } = require('./render');
const { withTransaction } = require('../tx');

const money2 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
const ymd = (d) => d.toISOString().substring(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

// Segunda-feira (UTC) da semana que contém `now` — base estável para idempotência.
function weekBounds(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return { start: ymd(d), end: ymd(addDays(d, 6)) };
}

async function runBilling(tenant_id, { now = new Date(), force = false } = {}) {
  const settings = await M.ensureSettings(tenant_id);
  await M.ensureDefaultTemplates(tenant_id);
  if (!settings.billing_enabled && !force) return { skipped: 'billing_disabled' };

  const { start: period_start, end: period_end } = weekBounds(now);
  const idempotency_key = `billing:${period_start}`;
  const run = await M.startRun({ tenant_id, run_type: 'billing', period_start, period_end, idempotency_key });
  if (!run.created) return { skipped: 'already_ran', period_start, period_end };
  const runRow = run.row;

  const statuses = Array.isArray(settings.billing_rental_statuses) ? settings.billing_rental_statuses : ['em_andamento', 'atrasado'];
  const provider = getPaymentProvider(settings);
  const template = await M.getActiveTemplate(tenant_id, 'billing');
  const dueDate = ymd(addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), Number(settings.billing_due_days || 3)));

  const all = await rentalModel.getAllRentals(tenant_id, {});
  const eligible = all.filter((r) => statuses.includes(r.status) && r.client_id && r.client_phone && Number(r.daily_rate) > 0);

  const counters = { rentals_processed: 0, charges_created: 0, messages_enqueued: 0, details: { billed: [], skipped: [] } };

  for (const rental of eligible) {
    const idemp = `${rental.id}:${period_start}:billing`;
    const existing = await M.getChargeByIdemp(tenant_id, idemp);
    if (existing) { counters.details.skipped.push(rental.rental_number); continue; }

    const amount = money2(Number(rental.daily_rate) * 7); // semana de diárias
    let extCharge = null;
    if (settings.billing_auto_create) {
      extCharge = await provider.createCharge({ amount, due_date: dueDate, client: { name: rental.client_name }, description: `Locação ${rental.rental_number}` }).catch(() => null);
    }

    await withTransaction(async (db) => {
      const billing = await billingModel.createBilling({
        tenant_id, client_id: rental.client_id, rental_id: rental.id,
        description: `Locação ${rental.rental_number} — semana ${period_start} a ${period_end}`,
        original_amount: amount, discount: 0, surcharge: 0, final_amount: amount, paid_amount: 0,
        installments: 1, due_date: dueDate, payment_method: 'pix', financial_status: 'faturado', created_by: null,
      }, db);

      if (settings.billing_auto_create) {
        const chargeRes = await M.insertCharge({
          tenant_id, rental_id: rental.id, billing_id: billing.id, client_id: rental.client_id,
          provider: provider.name, external_id: extCharge && extCharge.external_id, amount, due_date: dueDate,
          status: 'pending', pix_code: extCharge && extCharge.pix_code, payment_link: extCharge && extCharge.payment_link,
          expires_at: extCharge && extCharge.expires_at, period_start, period_end, idempotency_key: idemp,
        }, db);
        const charge = chargeRes.row;

        const vars = buildVars({ rental, charge: { ...charge, client_name: rental.client_name } });
        const body = template ? render(template.body, vars).text : `Cobrança da locação ${rental.rental_number}: ${vars.valor}`;
        await M.insertOutbox({
          tenant_id, client_id: rental.client_id, rental_id: rental.id, charge_id: charge.id,
          template_kind: 'billing', to_number: rental.client_phone, body, payload: vars, idempotency_key: `${idemp}:msg`,
        }, db);
        counters.charges_created++; counters.messages_enqueued++;
      }
      counters.details.billed.push(rental.rental_number);
    });
    counters.rentals_processed++;
  }

  await M.finishRun(runRow.id, tenant_id, { status: 'completed', ...counters });
  return { ok: true, period_start, period_end, ...counters };
}

module.exports = { runBilling, weekBounds };
