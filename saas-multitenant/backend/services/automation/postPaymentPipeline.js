'use strict';

// =============================================================================
// postPaymentPipeline.js — Pipeline ÚNICO disparado por PAGAMENTO CONFIRMADO.
//
// Chamado tanto pela conciliação do webhook quanto pela confirmação manual
// (§49: "não criar duas lógicas diferentes"). A regra do contador (§7/§8/§9):
//   pagamento confirmado
//     → se NFS-e habilitada E hoje >= nfse_mandatory_from  → emite NFS-e
//     → senão, se recibo habilitado                        → gera RECIBO
//     → envia o documento ao cliente (WhatsApp), se permitido.
//
// Nunca desfaz o pagamento se o fiscal falhar (§9): o pagamento continua PAID e
// o documento fiscal fica na fila de correção (fiscalService cuida do estado).
// Idempotente: recibo é único por pagamento; NFS-e usa idempotency_key; a
// mensagem de documento usa idempotency_key própria.
// =============================================================================

const M = require('../../models/automationModels');
const paymentModel = require('../../models/paymentModels');
const billingModel = require('../../models/serviceBillingModels');
const rentalModel = require('../../models/rentalModels');
const clientModel = require('../../models/clientModels');
const receiptModel = require('../../models/receiptModels');
const receiptService = require('../finance/receiptService');
const fiscalService = require('./fiscalService');
const audit = require('./auditService');
const publicLinks = require('./publicLinks');
const { render, buildVars } = require('./render');
const { zonedParts } = require('./timezone');

// Decide o documento devido para um pagamento confirmado, na data do tenant.
function resolveDocumentKind(settings = {}, { now = new Date() } = {}) {
  const tz = settings.billing_timezone || 'America/Sao_Paulo';
  const today = zonedParts(now, tz).ymd; // YYYY-MM-DD no fuso do tenant
  const mandatoryFrom = settings.nfse_mandatory_from
    ? String(settings.nfse_mandatory_from).slice(0, 10)
    : null;
  const nfseDateReached = !mandatoryFrom || today >= mandatoryFrom;
  const nfseConfigured = settings.nfse_enabled && settings.fiscal_enabled && nfseDateReached;
  if (nfseConfigured) {
    // A NFS-e é o documento devido. Emite aqui só no modo after_payment; nos
    // demais modos ela é emitida no seu próprio gatilho — e então NÃO geramos
    // recibo por cima (evita documento duplicado para a mesma operação).
    return (settings.fiscal_mode || 'after_payment') === 'after_payment' ? 'nfse' : 'none';
  }
  if (settings.receipts_enabled) return 'receipt';
  return 'none';
}

// Gera o recibo de forma idempotente: se já existe recibo ativo para o
// pagamento, devolve o existente em vez de emitir outro.
async function issueReceiptIdempotent(tenant_id, ctx) {
  const existing = await receiptModel.getActiveReceiptByPayment(ctx.payment.id, tenant_id).catch(() => null);
  if (existing) return { receipt: existing, created: false };
  const rental = ctx.rental;
  const periodo = rental && rental.start_date
    ? `${String(rental.start_date).slice(0, 10)}${rental.end_date ? ` a ${String(rental.end_date).slice(0, 10)}` : ''}`
    : null;
  const serviceDescription = rental
    ? `Locação ${rental.rental_number || ''}${rental.vehicle_plate ? ` - ${rental.vehicle_plate}` : ''}${periodo ? ` (${periodo})` : ''}`.trim()
    : 'Locação de veículo';
  try {
    const receipt = await receiptService.issueReceipt({
      tenant_id,
      payment_id: ctx.payment.id,
      billing_id: ctx.billing?.id || ctx.payment.billing_id || null,
      rental_id: rental?.id || null,
      client_id: ctx.client?.id || ctx.payment.client_id || null,
      client_name: ctx.client?.name || rental?.client_name || null,
      client_document: ctx.client?.cpf || null,
      service_description: serviceDescription,
      amount: ctx.payment.amount,
      payment_method: ctx.payment.payment_method || null,
      created_by: ctx.created_by || null,
      created_by_name: ctx.created_by_name || 'Automação',
    });
    return { receipt, created: true };
  } catch (err) {
    // Corrida: outro processo emitiu no mesmo instante → reaproveita o ativo.
    const again = await receiptModel.getActiveReceiptByPayment(ctx.payment.id, tenant_id).catch(() => null);
    if (again) return { receipt: again, created: false };
    throw err;
  }
}

// Executa o pipeline para um pagamento já confirmado (status 'confirmado').
async function runForPayment(tenant_id, {
  payment_id, charge = null, settings = null, now = new Date(),
  created_by = null, created_by_name = null,
} = {}) {
  settings = settings || (await M.getSettings(tenant_id)) || {};
  const payment = await paymentModel.getPaymentById(payment_id, tenant_id);
  if (!payment) return { ok: false, reason: 'payment_not_found' };

  const billing = (charge?.billing_id || payment.billing_id)
    ? await billingModel.getBillingById(charge?.billing_id || payment.billing_id, tenant_id).catch(() => null)
    : null;
  const rental_id = charge?.rental_id || billing?.rental_id || null;
  const rental = rental_id ? await rentalModel.getRentalById(rental_id, tenant_id).catch(() => null) : null;
  const client_id = charge?.client_id || billing?.client_id || payment.client_id || rental?.client_id || null;
  const client = client_id ? await clientModel.getClientById(client_id, tenant_id).catch(() => null) : null;

  const kind = resolveDocumentKind(settings, { now });
  let receipt = null;
  let fiscal = null;
  let documentInfo = null; // { tipo, numero, link } para a mensagem ao cliente

  if (kind === 'nfse') {
    fiscal = await fiscalService
      .issueForPayment(tenant_id, payment_id, { settings, created_by })
      .catch((err) => ({ status: 'failed', error_code: err.code || 'PROVIDER_ERROR', error_message: err.message }));
    if (fiscal && fiscal.status === 'authorized') {
      documentInfo = {
        tipo: 'NFS-e', numero: fiscal.number || fiscal.external_id || fiscal.id,
        link: fiscal.archived_document?.file_url || fiscal.pdf_url || fiscal.xml_url || null,
      };
    }
    // Se pendente/falha: pagamento segue PAID; fiscal fica na fila (§9). Sem recibo por cima.
  } else if (kind === 'receipt') {
    const out = await issueReceiptIdempotent(tenant_id, { payment, billing, rental, client, created_by, created_by_name });
    receipt = out.receipt;
    if (receipt) {
      documentInfo = { tipo: 'Recibo', numero: receipt.full_number, link: publicLinks.receiptLink(tenant_id, receipt.id) };
    }
  }

  // Envia o documento ao cliente pelo canal configurado (§25/§39), se houver
  // link e o envio automático estiver ligado. Idempotente por pagamento+tipo.
  let message = null;
  const canSend = documentInfo && documentInfo.link && settings.whatsapp_enabled
    && settings.document_auto_send !== false && rental?.client_phone;
  if (canSend) {
    const template = await M.getActiveTemplate(tenant_id, 'document').catch(() => null);
    const vars = buildVars({
      rental,
      charge: charge || { amount: payment.amount, period_start: billing?.period_start, period_end: billing?.period_end },
      payment,
      document: documentInfo,
    });
    const text = template ? render(template.body, vars).text
      : `Olá, ${vars.nome_cliente}. Seu ${documentInfo.tipo} ${documentInfo.numero} já está disponível: ${documentInfo.link}`;
    const res = await M.insertOutbox({
      tenant_id, client_id, rental_id, charge_id: charge?.id || null,
      template_kind: 'document', to_number: rental.client_phone, body: text, payload: vars,
      idempotency_key: `${payment_id}:document`,
    }).catch(() => null);
    message = res?.row || res || null;
  }

  await audit.record({
    tenant_id, event_type: 'document_pipeline',
    status: kind === 'none' ? 'skipped' : (documentInfo ? 'completed' : 'pending'),
    client_id, rental_id, payment_id, billing_id: billing?.id || null,
    fiscal_document_id: (fiscal && fiscal.id) || null, amount: payment.amount,
    details: {
      kind,
      document: documentInfo?.numero || null,
      fiscal_status: fiscal?.status || null,
      message_enqueued: !!message,
    },
  }).catch(() => {});

  return { ok: true, kind, receipt, fiscal, message, document: documentInfo };
}

module.exports = { runForPayment, resolveDocumentKind, issueReceiptIdempotent };
