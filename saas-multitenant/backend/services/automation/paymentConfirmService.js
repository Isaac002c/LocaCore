'use strict';

const crypto = require('node:crypto');
const M = require('../../models/automationModels');
const paymentModel = require('../../models/paymentModels');
const rentalModel = require('../../models/rentalModels');
const tenantModel = require('../../models/tenantModels');
const paymentService = require('../finance/paymentService');
const { createDbRepo } = require('../finance/financeRepo');
const { getPaymentProvider } = require('./providers/payment');
const { render, buildVars } = require('./render');
const postPaymentPipeline = require('./postPaymentPipeline');
const secretStore = require('./secretStore');
const audit = require('./auditService');
const activityLog = require('../activityLogService');
const { zonedParts } = require('./timezone');

const cents = (value) => Math.round(Number(value || 0) * 100);

async function resolveCharge(providerName, parsed) {
  if (parsed.charge_external_id) {
    const byExternal = await M.getChargeByExternal(providerName, parsed.charge_external_id);
    if (byExternal) return byExternal;
  }
  if (parsed.charge_public_id) return M.getChargeByPublicId(providerName, parsed.charge_public_id);
  return null;
}

async function providerForCharge(charge, settings) {
  const [stored, tenant] = await Promise.all([
    secretStore.getSecrets(charge.tenant_id, `payment:${charge.provider}`),
    tenantModel.getTenantById(charge.tenant_id).catch(() => null),
  ]);
  return getPaymentProvider(settings, { secretFn: secretStore.resolver(stored, tenant?.slug) });
}

async function handleWebhook(providerName, body, {
  rawBody = Buffer.from(JSON.stringify(body || {})), headers = {}, now = new Date(), repo,
} = {}) {
  const requestedProvider = String(providerName || '').toLowerCase();
  const parser = getPaymentProvider({ payment_provider: requestedProvider });
  const parsed = parser.parseWebhook(body || {});
  const charge = await resolveCharge(parser.name, parsed);
  if (!charge) return { ok: true, ignored: true, reason: 'charge_not_found' };

  const tenant_id = charge.tenant_id;
  const settings = await M.getSettings(tenant_id) || {};
  if (String(settings.payment_provider || '').toLowerCase() !== parser.name || charge.provider !== parser.name) {
    return { ok: false, ignored: true, reason: 'provider_mismatch' };
  }
  const provider = await providerForCharge(charge, settings);
  const signature = provider.verifyWebhookSignature(rawBody, headers);
  if (!signature.valid) {
    await audit.record({ tenant_id, event_type: 'payment_webhook_rejected', status: 'rejected',
      charge_id: charge.id, provider: provider.name, error_code: 'INVALID_SIGNATURE' });
    const err = new Error('Assinatura do webhook invalida.'); err.statusCode = 401; throw err;
  }

  const eventId = parsed.external_event_id || crypto.createHash('sha256').update(rawBody).digest('hex');
  const eventIsNew = await M.registerWebhookEvent({
    tenant_id, provider: provider.name, kind: 'payment', external_event_id: eventId,
    payload_hash: crypto.createHash('sha256').update(rawBody).digest('hex'),
    correlation_id: charge.correlation_id,
  });
  if (!eventIsNew) return { ok: true, duplicate: true };

  try {
    await audit.record({ tenant_id, event_type: 'payment_webhook_received', status: 'received',
      charge_id: charge.id, rental_id: charge.rental_id, client_id: charge.client_id,
      amount: parsed.amount, provider: provider.name, request_id: eventId,
      correlation_id: charge.correlation_id, details: { public_id: charge.public_id } });

    if (parsed.status && !['paid', 'waiting_payment'].includes(parsed.status)) {
      if (['expired', 'cancelled', 'canceled'].includes(parsed.status)) {
        await M.updateCharge(charge.id, tenant_id, { status: parsed.status === 'expired' ? 'overdue' : 'cancelled' });
      }
      await M.markWebhookProcessed(provider.name, eventId);
      return { ok: true, status: parsed.status };
    }

    // O webhook e apenas uma notificacao. A baixa depende desta consulta ativa.
    const verification = await provider.verifyPayment({ charge, webhook: parsed });
    const verifiedAmount = verification.paid_amount ?? verification.amount;
    if (!verification.verified || !verification.paid) {
      await M.updateCharge(charge.id, tenant_id, {
        status: 'needs_attention', error_code: 'PAYMENT_NOT_VERIFIED',
        error_message: 'O provedor nao confirmou o pagamento consultado.',
        transaction_nsu: verification.transaction_nsu || parsed.transaction_nsu || null,
      });
      await M.markWebhookProcessed(provider.name, eventId, { status: 'needs_attention', error_message: 'payment_not_verified' });
      return { ok: true, confirmed: false, status: 'needs_attention' };
    }
    if (verifiedAmount == null || cents(verifiedAmount) !== cents(charge.amount)) {
      await M.updateCharge(charge.id, tenant_id, {
        status: 'needs_attention', error_code: 'AMOUNT_MISMATCH',
        error_message: `Valor confirmado diverge da cobranca ${charge.public_id}.`,
        transaction_nsu: verification.transaction_nsu || parsed.transaction_nsu || null,
      });
      await audit.record({ tenant_id, event_type: 'payment_verification_failed', status: 'needs_attention',
        charge_id: charge.id, amount: verifiedAmount, provider: provider.name,
        request_id: eventId, error_code: 'AMOUNT_MISMATCH' });
      await M.markWebhookProcessed(provider.name, eventId, { status: 'needs_attention', error_message: 'amount_mismatch' });
      return { ok: true, confirmed: false, status: 'needs_attention' };
    }

    const existingPayments = charge.billing_id
      ? await paymentModel.getPaymentsByBilling(charge.billing_id, tenant_id)
      : [];
    let payment = existingPayments.find((p) => p.status === 'confirmado');
    if (!payment) {
      if (!charge.billing_id) throw Object.assign(new Error('Cobranca sem faturamento conciliavel.'), { code: 'MISSING_BILLING' });
      const localDate = zonedParts(now, settings.billing_timezone || 'America/Sao_Paulo').ymd;
      const result = await paymentService.confirmPayment({
        tenant_id, billing_id: charge.billing_id, amount: charge.amount,
        payment_date: localDate, payment_method: 'pix', category_id: null,
        entry_description: `Recebimento automatico - ${charge.public_id || charge.id}`,
      }, repo || createDbRepo());
      payment = result.payment;
    }

    await M.updateCharge(charge.id, tenant_id, {
      status: 'paid', confirmed_at: now.toISOString(), error_code: null, error_message: null,
      transaction_nsu: verification.transaction_nsu || parsed.transaction_nsu || null,
      receipt_url: verification.receipt_url || parsed.receipt_url || null,
    });
    await M.cancelRemindersForCharge(tenant_id, charge.id);

    const rental = charge.rental_id ? await rentalModel.getRentalById(charge.rental_id, tenant_id) : null;
    const template = await M.getActiveTemplate(tenant_id, 'payment_confirmed');
    const variables = buildVars({ rental: rental || { rental_number: '', client_name: charge.client_id }, charge, payment });
    const message = template ? render(template.body, variables).text : `Pagamento confirmado. Valor ${variables.valor}.`;
    if (settings.whatsapp_enabled
      && settings.whatsapp_config?.send_payment_confirmation !== false
      && rental?.client_phone) {
      await M.insertOutbox({
        tenant_id, client_id: charge.client_id, rental_id: charge.rental_id, charge_id: charge.id,
        template_kind: 'payment_confirmed', to_number: rental.client_phone, body: message, payload: variables,
        idempotency_key: `${charge.id}:confirmed`,
      });
    }

    // Pipeline único de pós-pagamento: recibo (antes da obrigatoriedade) ou
    // NFS-e (a partir dela) + envio do documento ao cliente (§7/§8/§9/§25).
    let pipelineError = null;
    const pipeline = await postPaymentPipeline.runForPayment(tenant_id, {
      payment_id: payment.id, charge, settings, now,
    }).catch((err) => {
      pipelineError = { code: err.code || 'DOCUMENT_PIPELINE_ERROR', message: err.message };
      return null;
    });
    const fiscal = pipeline?.fiscal || null;

    await audit.record({ tenant_id, event_type: 'payment_reconciled', status: 'paid',
      client_id: charge.client_id, rental_id: charge.rental_id, charge_id: charge.id,
      billing_id: charge.billing_id, payment_id: payment.id, amount: charge.amount,
      provider: provider.name, request_id: eventId, correlation_id: charge.correlation_id,
      details: { public_id: charge.public_id, transaction_nsu: verification.transaction_nsu || parsed.transaction_nsu } });
    await M.markWebhookProcessed(provider.name, eventId);
    activityLog.logGeneric(tenant_id, null, 'payment', 'charge',
      `Pagamento confirmado - ${charge.public_id || charge.id}`, { charge_id: charge.id, payment_id: payment.id }).catch(() => {});
    return {
      ok: true, confirmed: true, payment_id: payment.id,
      fiscal_status: fiscal?.status || null,
      fiscal_error_code: fiscal?.error_code || pipelineError?.code || null,
      fiscal_error_message: fiscal?.error_message || pipelineError?.message || null,
    };
  } catch (err) {
    await M.markWebhookProcessed(provider.name, eventId, { status: 'failed', error_message: err.message }).catch(() => {});
    throw err;
  }
}

// ── Confirmação manual (§49) ─────────────────────────────────────────────────
// Enquanto a InfinitePay não está conectada, um usuário autorizado confirma o
// pagamento à mão. Dispara EXATAMENTE o mesmo pipeline do webhook (recibo/NFS-e
// → documento → WhatsApp) — sem lógica paralela.
async function confirmManual(tenant_id, charge_id, {
  amount = null, payment_date = null, payment_method = 'pix', notes = null,
  now = new Date(), created_by = null, created_by_name = null, repo,
} = {}) {
  const charge = await M.getChargeForUpdate(charge_id, tenant_id);
  if (!charge) { const e = new Error('Cobrança não encontrada.'); e.statusCode = 404; throw e; }
  if (charge.status === 'paid') { const e = new Error('Cobrança já está paga.'); e.statusCode = 409; throw e; }
  if (!charge.billing_id) {
    const e = new Error('Cobrança sem faturamento conciliável. Gere a cobrança antes de confirmar.');
    e.statusCode = 409; throw e;
  }
  const settings = (await M.getSettings(tenant_id)) || {};
  const localDate = zonedParts(now, settings.billing_timezone || 'America/Sao_Paulo').ymd;
  const confirmAmount = amount != null ? amount : charge.amount;

  // Idempotente: se já houver pagamento confirmado no faturamento, reaproveita.
  const existing = await paymentModel.getPaymentsByBilling(charge.billing_id, tenant_id);
  let payment = existing.find((p) => p.status === 'confirmado');
  if (!payment) {
    const result = await paymentService.confirmPayment({
      tenant_id, billing_id: charge.billing_id, amount: confirmAmount,
      payment_date: payment_date || localDate, payment_method: payment_method || 'pix', category_id: null,
      entry_description: `Confirmação manual - ${charge.public_id || charge.id}`,
    }, repo || createDbRepo());
    payment = result.payment;
  }

  await M.updateCharge(charge.id, tenant_id, {
    status: 'paid', confirmed_at: now.toISOString(), error_code: null, error_message: null,
  });
  await M.cancelRemindersForCharge(tenant_id, charge.id);

  const rental = charge.rental_id ? await rentalModel.getRentalById(charge.rental_id, tenant_id).catch(() => null) : null;
  if (settings.whatsapp_enabled
    && settings.whatsapp_config?.send_payment_confirmation !== false
    && rental?.client_phone) {
    const template = await M.getActiveTemplate(tenant_id, 'payment_confirmed').catch(() => null);
    const variables = buildVars({ rental, charge, payment });
    const message = template ? render(template.body, variables).text : `Pagamento confirmado. Valor ${variables.valor}.`;
    await M.insertOutbox({
      tenant_id, client_id: charge.client_id, rental_id: charge.rental_id, charge_id: charge.id,
      template_kind: 'payment_confirmed', to_number: rental.client_phone, body: message, payload: variables,
      idempotency_key: `${charge.id}:confirmed`,
    }).catch(() => {});
  }

  await audit.record({
    tenant_id, event_type: 'payment_confirmed_manual', status: 'paid',
    client_id: charge.client_id, rental_id: charge.rental_id, charge_id: charge.id,
    billing_id: charge.billing_id, payment_id: payment.id, amount: confirmAmount,
    provider: 'manual', request_id: created_by ? `user:${created_by}` : null,
    details: { public_id: charge.public_id, payment_method, notes: notes ? String(notes).slice(0, 200) : null },
  }).catch(() => {});

  let pipelineError = null;
  const pipeline = await postPaymentPipeline.runForPayment(tenant_id, {
    payment_id: payment.id, charge, settings, now, created_by, created_by_name,
  }).catch((err) => {
    pipelineError = { code: err.code || 'DOCUMENT_PIPELINE_ERROR', message: err.message };
    return null;
  });

  activityLog.logGeneric(tenant_id, created_by, 'payment', 'charge',
    `Pagamento confirmado manualmente - ${charge.public_id || charge.id}`,
    { charge_id: charge.id, payment_id: payment.id }).catch(() => {});

  return {
    ok: true, payment_id: payment.id, charge_id: charge.id,
    document: pipeline?.document || null,
    fiscal_status: pipeline?.fiscal?.status || null,
    fiscal_error_code: pipeline?.fiscal?.error_code || pipelineError?.code || null,
    fiscal_error_message: pipeline?.fiscal?.error_message || pipelineError?.message || null,
    kind: pipeline?.kind || 'none',
  };
}

module.exports = { handleWebhook, resolveCharge, confirmManual, cents };
