'use strict';

const M = require('../../models/automationModels');
const billingModel = require('../../models/serviceBillingModels');
const paymentModel = require('../../models/paymentModels');
const clientModel = require('../../models/clientModels');
const rentalModel = require('../../models/rentalModels');
const vehicleModel = require('../../models/vehicleModels');
const tenantModel = require('../../models/tenantModels');
const secretStore = require('./secretStore');
const certificateService = require('./fiscalCertificateService');
const audit = require('./auditService');
const { getFiscalProvider } = require('./providers/fiscal');
const { render, buildVars } = require('./render');
const { zonedParts } = require('./timezone');
const { archiveAuthorizedFiscal } = require('./fiscalArchiveService');

const MAX_RETRIES = 5;
const RETRYABLE = new Set(['failed', 'error']);
const backoffMinutes = (attempt) => Math.min(360, 5 * (2 ** Math.max(0, attempt - 1)));

async function providerForTenant(tenant_id, settings) {
  const providerName = settings.fiscal_provider || 'null';
  const [stored, tenant, certificate] = await Promise.all([
    secretStore.getSecrets(tenant_id, `fiscal:${providerName}`),
    tenantModel.getTenantById(tenant_id).catch(() => null),
    providerName === 'nfse_nacional'
      ? certificateService.getDecryptedCertificate(tenant_id).catch(() => null)
      : Promise.resolve(null),
  ]);
  return getFiscalProvider(settings, {
    secretFn: secretStore.resolver(stored, tenant?.slug), certificate,
  });
}

async function contextFor({ tenant_id, payment_id = null, billing_id = null, rental_id = null, client_id = null }) {
  const payment = payment_id ? await paymentModel.getPaymentById(payment_id, tenant_id) : null;
  const resolvedBillingId = billing_id || payment?.billing_id || null;
  const billing = resolvedBillingId ? await billingModel.getBillingById(resolvedBillingId, tenant_id) : null;
  const resolvedRentalId = rental_id || billing?.rental_id || null;
  const rental = resolvedRentalId ? await rentalModel.getRentalById(resolvedRentalId, tenant_id).catch(() => null) : null;
  const resolvedClientId = client_id || billing?.client_id || payment?.client_id || rental?.client_id || null;
  const [client, vehicle] = await Promise.all([
    resolvedClientId ? clientModel.getClientById(resolvedClientId, tenant_id).catch(() => null) : null,
    rental?.vehicle_id ? vehicleModel.getVehicleById(rental.vehicle_id, tenant_id).catch(() => null) : null,
  ]);
  return { payment, billing, rental, client, vehicle,
    payment_id: payment?.id || payment_id, billing_id: billing?.id || resolvedBillingId,
    rental_id: rental?.id || resolvedRentalId, client_id: client?.id || resolvedClientId };
}

async function archiveFiscal(tenant_id, fiscal, context, created_by = null) {
  try {
    const result = await archiveAuthorizedFiscal({ tenant_id, fiscal, context, created_by });
    await audit.record({
      tenant_id, event_type: 'fiscal_archive', status: result.archived ? 'completed' : 'pending',
      client_id: context.client_id, rental_id: context.rental_id, billing_id: context.billing_id,
      payment_id: context.payment_id, fiscal_document_id: fiscal.id,
      details: { reason: result.reason || null, document_id: result.document?.id || null, created: result.created === true },
    }).catch(() => {});
    return result;
  } catch (err) {
    await audit.record({
      tenant_id, event_type: 'fiscal_archive', status: 'needs_attention',
      client_id: context.client_id, rental_id: context.rental_id, billing_id: context.billing_id,
      payment_id: context.payment_id, fiscal_document_id: fiscal.id,
      error_code: err.code || 'FISCAL_ARCHIVE_FAILED', error_message: err.message,
    }).catch(() => {});
    return { archived: false, error_code: err.code || 'FISCAL_ARCHIVE_FAILED', error_message: err.message };
  }
}

async function executeDocument(tenant_id, doc, context, settings) {
  const provider = await providerForTenant(tenant_id, settings);
  const category = await M.getFiscalCategoryMapping(tenant_id, 'locacao').catch(() => null);
  const mappedSettings = category ? {
    ...settings,
    fiscal_config: {
      ...(settings.fiscal_config || {}),
      codigo_tributacao_nacional: category.national_tax_code || settings.fiscal_config?.codigo_tributacao_nacional,
      codigo_servico: category.municipal_service_code || settings.fiscal_config?.codigo_servico,
      cst_ibs_cbs: category.cst_ibs_cbs || settings.fiscal_config?.cst_ibs_cbs,
      classificacao_tributaria: category.tax_classification || settings.fiscal_config?.classificacao_tributaria,
      tratamento_iss: category.iss_treatment || settings.fiscal_config?.tratamento_iss,
    },
  } : settings;
  const validation = provider.validateConfiguration(mappedSettings);
  const missing = [...(validation.missing || [])];
  if (!context.client?.cpf) missing.push('CPF/CNPJ do tomador');
  if (provider.name === 'nfse_nacional' && !context.vehicle?.ncm) missing.push('NCM do veiculo');
  if (missing.length) {
    return M.updateFiscal(doc.id, tenant_id, {
      status: 'pending_configuration', error_code: 'CONFIG_INCOMPLETE',
      error_message: `Configuração fiscal incompleta: ${[...new Set(missing)].join(', ')}.`,
      next_attempt_at: null,
    });
  }
  const attempt = Number(doc.retry_count || 0) + 1;
  await M.updateFiscal(doc.id, tenant_id, { status: 'processing', retry_count: attempt, error_code: null, error_message: null });
  const result = await provider.issueDocument({
    tenant_id, ref: doc.id, amount: doc.amount, document_type: doc.document_type,
    client: context.client, rental: context.rental, vehicle: context.vehicle,
    billing: context.billing, payment: context.payment, settings: mappedSettings,
  }).catch((err) => ({ status: 'failed', error_code: err.code || 'PROVIDER_ERROR', error_message: err.message }));

  let status = result.status || 'processing';
  let nextAttempt = null;
  if (RETRYABLE.has(status)) {
    if (attempt >= MAX_RETRIES) status = 'needs_attention';
    else nextAttempt = new Date(Date.now() + backoffMinutes(attempt) * 60000).toISOString();
  }
  const patch = {
    status, external_id: result.external_id, number: result.number, series: result.series,
    verification_code: result.verification_code, pdf_url: result.pdf_url, xml_url: result.xml_url,
    error_code: result.error_code, error_message: result.error_message,
    next_attempt_at: nextAttempt, fiscal_category: 'locacao',
    provider_payload: { provider_status: result.provider_status || result.status || null },
  };
  if (status === 'authorized') {
    patch.authorization_date = new Date().toISOString();
    const cost = provider.estimateIssueCost(settings);
    if (cost > 0) await M.recordCost({ tenant_id, kind: 'fiscal_document', ref_id: doc.id, provider: provider.name, unit_cost: cost });
  }
  const updated = await M.updateFiscal(doc.id, tenant_id, patch);
  let archived = null;
  if (status === 'authorized') {
    // Primeiro persiste a autorização; uma falha de storage jamais desfaz a
    // nota nem o pagamento. O erro fica auditado e pode ser tentado novamente.
    archived = await archiveFiscal(tenant_id, updated, context, doc.created_by || null);
    // Envia a NFS-e ao cliente (§39), inclusive quando a autorização é ASSÍNCRONA
    // (o pipeline pós-pagamento só envia no caso síncrono). Mesma idempotency_key
    // por pagamento → nunca duplica com o envio do pipeline.
    const link = archived?.document?.file_url || result.pdf_url || result.xml_url || null;
    if (settings.whatsapp_enabled && settings.document_auto_send !== false
      && context.rental?.client_phone && link && context.payment_id) {
      const tpl = await M.getActiveTemplate(tenant_id, 'document').catch(() => null);
      const vars = buildVars({
        rental: context.rental, payment: context.payment,
        document: { tipo: 'NFS-e', numero: result.number || result.external_id || doc.id, link },
      });
      const text = tpl ? render(tpl.body, vars).text
        : `Sua NFS-e ${result.number || ''} já está disponível: ${link}`;
      await M.insertOutbox({
        tenant_id, client_id: context.client_id, rental_id: context.rental_id, charge_id: null,
        template_kind: 'document', to_number: context.rental.client_phone, body: text, payload: vars,
        idempotency_key: `${context.payment_id}:document`,
      }).catch(() => {});
    }
  }
  await audit.record({ tenant_id, event_type: 'fiscal_issue', status,
    client_id: context.client_id, rental_id: context.rental_id, billing_id: context.billing_id,
    payment_id: context.payment_id, fiscal_document_id: doc.id, amount: doc.amount,
    provider: provider.name, attempt, error_code: result.error_code, error_message: result.error_message,
    details: { document_type: doc.document_type, provider_status: result.provider_status || result.status,
      archived_in_client: archived?.archived === true, archive_error: archived?.error_code || null } });
  return { ...updated, archived_document: archived?.document || null };
}

async function createAndIssue(tenant_id, contextInput, idempotency_key, amount, { settings, created_by } = {}) {
  settings = settings || await M.getSettings(tenant_id) || {};
  if (!settings.fiscal_enabled) return { skipped: 'fiscal_disabled' };
  const context = await contextFor({ tenant_id, ...contextInput });
  const docType = settings.fiscal_document_type || 'fiscal';
  const existing = await M.getFiscalByIdemp(tenant_id, idempotency_key);
  if (existing) {
    if (existing.status === 'authorized') {
      const archived = await archiveFiscal(tenant_id, existing, context, created_by || existing.created_by || null);
      return { ...existing, archived_document: archived?.document || null };
    }
    return existing;
  }
  const provider = await providerForTenant(tenant_id, settings);
  const inserted = await M.insertFiscal({
    tenant_id, payment_id: context.payment_id, billing_id: context.billing_id,
    rental_id: context.rental_id, client_id: context.client_id,
    provider: provider.name, document_type: docType, amount,
    status: 'pending', idempotency_key, created_by,
  });
  if (!inserted.created) return inserted.row;
  return executeDocument(tenant_id, inserted.row, context, settings);
}

async function issueForPayment(tenant_id, payment_id, options = {}) {
  const payment = await paymentModel.getPaymentById(payment_id, tenant_id);
  if (!payment) return null;
  const settings = options.settings || await M.getSettings(tenant_id) || {};
  const docType = settings.fiscal_document_type || 'fiscal';
  return createAndIssue(tenant_id, { payment_id }, `${payment_id}:${docType}`,
    payment.amount, { ...options, settings });
}

async function issueForCharge(tenant_id, charge_id, options = {}) {
  const charge = await M.getChargeForUpdate(charge_id, tenant_id);
  if (!charge) return null;
  const settings = options.settings || await M.getSettings(tenant_id) || {};
  const docType = settings.fiscal_document_type || 'fiscal';
  return createAndIssue(tenant_id, {
    billing_id: charge.billing_id, rental_id: charge.rental_id, client_id: charge.client_id,
  }, `charge:${charge.id}:${docType}`, charge.amount, { ...options, settings });
}

async function runBatch(tenant_id, { limit = 100, now = new Date() } = {}) {
  const settings = await M.getSettings(tenant_id) || {};
  if (!settings.fiscal_enabled) return { skipped: 'fiscal_disabled' };
  if (settings.automation_mode !== undefined && !['pilot', 'staged', 'global'].includes(settings.automation_mode)) return { skipped: 'automation_not_active' };
  const pool = require('../../config/db');
  let rows = [];
  if (settings.fiscal_mode === 'on_due_date') {
    const today = zonedParts(now, settings.billing_timezone || 'America/Sao_Paulo').ymd;
    rows = (await pool.query(
      `SELECT id FROM charges WHERE tenant_id=$1 AND due_date <= $2
        AND status IN ('waiting_payment','paid','overdue') ORDER BY due_date LIMIT $3`,
      [tenant_id, today, limit],
    )).rows.map((row) => ({ kind: 'charge', id: row.id }));
  } else {
    rows = (await pool.query(
      `SELECT p.id FROM payments p JOIN service_billings b ON b.id=p.billing_id AND b.tenant_id=p.tenant_id
        WHERE p.tenant_id=$1 AND p.status='confirmado' AND b.rental_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.tenant_id=p.tenant_id AND f.payment_id=p.id)
        ORDER BY p.created_at DESC LIMIT $2`, [tenant_id, limit],
    )).rows.map((row) => ({ kind: 'payment', id: row.id }));
  }
  let issued = 0;
  for (const row of rows) {
    if (row.kind === 'charge') await issueForCharge(tenant_id, row.id, { settings });
    else await issueForPayment(tenant_id, row.id, { settings });
    issued++;
  }
  return { ok: true, issued };
}

async function retry(tenant_id, id) {
  const doc = await M.getFiscalById(tenant_id, id);
  if (!doc) return null;
  const settings = await M.getSettings(tenant_id) || {};
  const context = await contextFor({ tenant_id, payment_id: doc.payment_id, billing_id: doc.billing_id,
    rental_id: doc.rental_id, client_id: doc.client_id });
  if (doc.status === 'authorized') {
    const archived = await archiveFiscal(tenant_id, doc, context, doc.created_by || null);
    return { ...doc, archived_document: archived?.document || null };
  }
  if (!['failed', 'error', 'rejected', 'pending_configuration', 'needs_attention'].includes(doc.status)) return doc;
  const reset = await M.updateFiscal(id, tenant_id, { retry_count: 0, status: 'pending', next_attempt_at: null });
  return executeDocument(tenant_id, reset, context, settings);
}

module.exports = {
  issueForPayment, issueForCharge, runBatch, retry, providerForTenant,
  executeDocument, MAX_RETRIES, backoffMinutes,
};
