// =============================================================================
// receiptService.js — Emissão/cancelamento/reemissão de recibos.
//
// Numeração única por tenant, à prova de concorrência:
//   ensureSettingsForUpdate() faz SELECT ... FOR UPDATE na linha de settings,
//   serializando emissões simultâneas do mesmo tenant; bumpReceiptNumber()
//   incrementa e retorna o número. A constraint UNIQUE(tenant_id, number) é a
//   rede de segurança final contra duplicidade.
//
// Dados essenciais são "congelados" (snapshot) no momento da emissão. Não há
// edição de recibo emitido — correções se fazem por cancelamento + reemissão.
// =============================================================================

const { createDbRepo } = require('./financeRepo');
const { ValidationError, formatReceiptNumber } = require('./calc');
const { NotFoundError } = require('./paymentService');
const { DEFAULT_BRANDING } = require('./constants');

function buildIssuer(settings, input) {
  return {
    issuer_name: settings.razao_social || input.defaultIssuerName || DEFAULT_BRANDING.name,
    issuer_document: settings.document || input.defaultIssuerDocument || null,
    issuer_address: settings.address || input.defaultIssuerAddress || null,
  };
}

// Emite um recibo vinculado a um pagamento (dentro de uma transação).
async function issueReceipt(input, repo = createDbRepo()) {
  if (!input.tenant_id) throw new ValidationError('tenant_id é obrigatório');
  if (!input.payment_id) throw new ValidationError('Pagamento é obrigatório para emitir recibo');

  return repo.withTransaction(async (tx) => {
    const payment = await tx.getPayment(input.payment_id, input.tenant_id);
    if (!payment) throw new NotFoundError('Pagamento não encontrado');
    if (payment.status === 'cancelado') {
      throw new ValidationError('Não é possível emitir recibo de pagamento cancelado');
    }

    const existing = await tx.getActiveReceiptByPayment(input.payment_id, input.tenant_id);
    if (existing) {
      throw new ValidationError('Já existe um recibo ativo para este pagamento. Use reemitir.');
    }

    const settings = await tx.ensureSettingsForUpdate(input.tenant_id, input.defaultPrefix);
    const { number, prefix } = await tx.bumpReceiptNumber(input.tenant_id);
    const fullNumber = formatReceiptNumber(prefix, number);
    const issuer = buildIssuer(settings, input);

    const receipt = await tx.insertReceipt({
      tenant_id: input.tenant_id,
      number,
      prefix,
      full_number: fullNumber,
      issue_date: input.issue_date || null,
      client_id: input.client_id || payment.client_id || null,
      payment_id: input.payment_id,
      billing_id: input.billing_id || payment.billing_id || null,
      fine_id: input.fine_id || payment.fine_id || null,
      client_name: input.client_name || null,
      client_document: input.client_document || null,
      service_description: input.service_description || null,
      amount: input.amount != null ? input.amount : payment.amount,
      payment_method: input.payment_method || payment.payment_method || null,
      issuer_name: issuer.issuer_name,
      issuer_document: issuer.issuer_document,
      issuer_address: issuer.issuer_address,
      notes: input.notes || null,
      created_by: input.created_by || null,
      created_by_name: input.created_by_name || null,
    });

    return receipt;
  });
}

// Cancela um recibo (preserva no histórico).
async function cancelReceipt(receiptId, input, repo = createDbRepo()) {
  if (!input || !input.tenant_id) throw new ValidationError('tenant_id é obrigatório');
  return repo.withTransaction(async (tx) => {
    const receipt = await tx.getReceiptForUpdate(receiptId, input.tenant_id);
    if (!receipt) throw new NotFoundError('Recibo não encontrado');
    if (receipt.status === 'cancelado') throw new ValidationError('Recibo já está cancelado');
    const canceled = await tx.cancelReceiptRow(receiptId, input.tenant_id, input.reason);
    return canceled;
  });
}

// Reemite: cancela o recibo atual e emite um novo (novo número), tudo em 1 transação.
async function reissueReceipt(receiptId, input, repo = createDbRepo()) {
  if (!input || !input.tenant_id) throw new ValidationError('tenant_id é obrigatório');
  return repo.withTransaction(async (tx) => {
    const old = await tx.getReceiptForUpdate(receiptId, input.tenant_id);
    if (!old) throw new NotFoundError('Recibo não encontrado');
    if (old.status === 'emitido') {
      await tx.cancelReceiptRow(receiptId, input.tenant_id, input.reason || 'Reemissão');
    }

    const settings = await tx.ensureSettingsForUpdate(input.tenant_id, input.defaultPrefix);
    const { number, prefix } = await tx.bumpReceiptNumber(input.tenant_id);
    const fullNumber = formatReceiptNumber(prefix, number);
    const issuer = buildIssuer(settings, input);

    const receipt = await tx.insertReceipt({
      tenant_id: input.tenant_id,
      number,
      prefix,
      full_number: fullNumber,
      issue_date: input.issue_date || null,
      client_id: input.client_id || old.client_id || null,
      payment_id: input.payment_id || old.payment_id || null,
      billing_id: input.billing_id || old.billing_id || null,
      fine_id: input.fine_id || old.fine_id || null,
      client_name: input.client_name || old.client_name || null,
      client_document: input.client_document || old.client_document || null,
      service_description: input.service_description || old.service_description || null,
      amount: input.amount != null ? input.amount : old.amount,
      payment_method: input.payment_method || old.payment_method || null,
      issuer_name: issuer.issuer_name,
      issuer_document: issuer.issuer_document,
      issuer_address: issuer.issuer_address,
      notes: input.notes || old.notes || null,
      created_by: input.created_by || null,
      created_by_name: input.created_by_name || null,
    });

    return receipt;
  });
}

module.exports = { issueReceipt, cancelReceipt, reissueReceipt };
