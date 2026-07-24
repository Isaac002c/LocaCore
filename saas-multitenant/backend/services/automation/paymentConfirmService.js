// =============================================================================
// paymentConfirmService.js — Confirmação automática de pagamento (webhook).
//
// Fluxo idempotente e seguro: valida assinatura → localiza a cobrança pelo
// external_id (o TENANT vem da cobrança, NUNCA do payload) → registra o pagamento
// reusando o financeiro real → interrompe lembretes → enfileira confirmação →
// dispara emissão fiscal (modo after_payment). Reprocessar o mesmo evento não
// duplica pagamento, entrada, mensagem nem nota (guardas por status + pagamento
// existente + chaves de idempotência).
// =============================================================================

const M = require('../../models/automationModels');
const paymentModel = require('../../models/paymentModels');
const rentalModel = require('../../models/rentalModels');
const paymentService = require('../finance/paymentService');
const { createDbRepo } = require('../finance/financeRepo');
const { getPaymentProvider } = require('./providers/payment');
const { render, buildVars } = require('./render');
const fiscalService = require('./fiscalService');
const activityLog = require('../activityLogService');

const ymd = (d) => d.toISOString().substring(0, 10);

// A assinatura já foi validada na ROTA (corpo bruto). Aqui recebe o body parseado.
async function handleWebhook(providerName, body, { now = new Date(), repo } = {}) {
  const provider = getPaymentProvider({ payment_provider: providerName || 'null' });
  const parsed = provider.parseWebhook(body);
  const charge = await M.getChargeByExternal(provider.name, parsed.charge_external_id);
  if (!charge) return { ok: true, ignored: true, reason: 'charge_not_found' }; // não vaza dados

  const tenant_id = charge.tenant_id; // TENANT sempre da cobrança
  await M.registerWebhookEvent({ tenant_id, provider: provider.name, kind: 'payment', external_event_id: parsed.external_event_id });

  // Status não-pago: apenas reflete na cobrança.
  if (parsed.status && parsed.status !== 'paid') {
    if (['expired', 'canceled'].includes(parsed.status)) await M.setChargeStatus(charge.id, tenant_id, parsed.status);
    return { ok: true, status: parsed.status };
  }

  // Guarda de idempotência: pagamento já registrado para esta cobrança?
  const existingPayments = await paymentModel.getPaymentsByBilling(charge.billing_id, tenant_id);
  const alreadyPaid = existingPayments.some((p) => p.status === 'confirmado');
  if (charge.status === 'paid' && alreadyPaid) return { ok: true, duplicate: true };

  await M.setChargeStatus(charge.id, tenant_id, 'paid');

  let payment;
  if (alreadyPaid) {
    payment = existingPayments.find((p) => p.status === 'confirmado');
  } else {
    const r = await paymentService.confirmPayment({
      tenant_id, billing_id: charge.billing_id, amount: charge.amount,
      payment_date: ymd(now), payment_method: 'pix', category_id: null,
      entry_description: `Recebimento automático — cobrança ${charge.id}`,
    }, repo || createDbRepo());
    payment = r.payment;
  }

  // Interrompe lembretes desta cobrança.
  await M.cancelRemindersForCharge(tenant_id, charge.id);

  // Enfileira confirmação (idempotente).
  const rental = charge.rental_id ? await rentalModel.getRentalById(charge.rental_id, tenant_id) : null;
  const settings = await M.getSettings(tenant_id) || {};
  const template = await M.getActiveTemplate(tenant_id, 'payment_confirmed');
  const vars = buildVars({ rental: rental || { rental_number: '', client_name: charge.client_id }, charge, payment });
  const body2 = template ? render(template.body, vars).text : `Pagamento confirmado. Valor ${vars.valor}.`;
  await M.insertOutbox({
    tenant_id, client_id: charge.client_id, rental_id: charge.rental_id, charge_id: charge.id,
    template_kind: 'payment_confirmed', to_number: rental && rental.client_phone, body: body2, payload: vars,
    idempotency_key: `${charge.id}:confirmed`,
  });

  // Emissão fiscal (modo after_payment), sem bloquear o restante.
  let fiscal = null;
  if (settings.fiscal_enabled && settings.fiscal_mode === 'after_payment' && payment) {
    fiscal = await fiscalService.issueForPayment(tenant_id, payment.id, { settings }).catch(() => null);
  }

  activityLog.logGeneric(tenant_id, null, 'payment', 'charge',
    `Pagamento confirmado (webhook) — cobrança ${charge.id}`, { charge_id: charge.id, payment_id: payment && payment.id }).catch(() => {});

  return { ok: true, confirmed: true, payment_id: payment && payment.id, fiscal_status: fiscal && fiscal.status };
}

module.exports = { handleWebhook };
