// =============================================================================
// fiscalService.js — Emissão fiscal desacoplada. NÃO emite documento produtivo
// com valores inferidos nem sem provedor/credenciais: sem configuração válida, o
// documento fica 'pending_configuration'. Idempotente por (payment, tipo).
// =============================================================================

const M = require('../../models/automationModels');
const billingModel = require('../../models/serviceBillingModels');
const paymentModel = require('../../models/paymentModels');
const clientModel = require('../../models/clientModels');
const { getFiscalProvider } = require('./providers/fiscal');

async function issueForPayment(tenant_id, payment_id, { settings, created_by } = {}) {
  settings = settings || await M.getSettings(tenant_id) || {};
  if (!settings.fiscal_enabled) return { skipped: 'fiscal_disabled' };

  const doc_type = settings.fiscal_document_type || 'fiscal';
  const idemp = `${payment_id}:${doc_type}`;
  const existing = await M.getFiscalByIdemp(tenant_id, idemp);
  if (existing) return existing;

  const payment = await paymentModel.getPaymentById(payment_id, tenant_id);
  const billing = payment && payment.billing_id ? await billingModel.getBillingById(payment.billing_id, tenant_id) : null;
  const amount = (payment && payment.amount) || (billing && billing.final_amount) || 0;

  const provider = getFiscalProvider(settings);
  const validation = provider.validateConfiguration(settings);

  const ins = await M.insertFiscal({
    tenant_id, payment_id, billing_id: billing && billing.id, rental_id: billing && billing.rental_id,
    client_id: (billing && billing.client_id) || (payment && payment.client_id),
    provider: provider.name, document_type: doc_type, amount,
    status: validation.ok ? 'pending' : 'pending_configuration', idempotency_key: idemp, created_by,
  });
  const doc = ins.row;
  if (!ins.created) return doc; // corrida / já existente

  if (!validation.ok) {
    return M.updateFiscal(doc.id, tenant_id, {
      status: 'pending_configuration',
      error_code: 'CONFIG_INCOMPLETE',
      error_message: `Configuração fiscal incompleta: ${validation.missing.join(', ')}.`,
    });
  }

  // Tomador (destinatário) da nota — o provedor real precisa do CPF/CNPJ, nome e
  // e-mail do cliente, que não estão no pagamento/faturamento.
  const client = doc.client_id ? await clientModel.getClientById(doc.client_id, tenant_id).catch(() => null) : null;

  // Provedor configurado → tenta emitir. (Null/homologação sem creds → pendência.)
  // `ref` estável = id do documento fiscal (idempotente no provedor).
  const result = await provider.issueDocument({ tenant_id, ref: doc.id, amount, document_type: doc_type, client, settings })
    .catch((e) => ({ status: 'failed', error_code: 'PROVIDER_ERROR', error_message: e.message }));
  const patch = {
    status: result.status || 'pending',
    external_id: result.external_id, number: result.number, series: result.series,
    verification_code: result.verification_code, pdf_url: result.pdf_url, xml_url: result.xml_url,
    error_code: result.error_code, error_message: result.error_message,
  };
  if (result.status === 'authorized') {
    patch.authorization_date = new Date().toISOString();
    const cost = provider.estimateIssueCost(settings);
    if (cost > 0) await M.recordCost({ tenant_id, kind: 'fiscal_document', ref_id: doc.id, provider: provider.name, unit_cost: cost });
  }
  return M.updateFiscal(doc.id, tenant_id, patch);
}

// Modo lote (semanal): emite para pagamentos de locação ainda sem documento.
async function runBatch(tenant_id, { limit = 100 } = {}) {
  const settings = await M.getSettings(tenant_id) || {};
  if (!settings.fiscal_enabled) return { skipped: 'fiscal_disabled' };
  // Reaproveita issueForPayment sobre pagamentos confirmados de locação sem nota.
  const pool = require('../../config/db');
  const { rows } = await pool.query(
    `SELECT p.id FROM payments p
       JOIN service_billings b ON b.id = p.billing_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.status = 'confirmado' AND b.rental_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fiscal_documents f WHERE f.tenant_id = p.tenant_id AND f.payment_id = p.id)
      ORDER BY p.created_at DESC LIMIT $2`,
    [tenant_id, limit]
  ).catch(() => ({ rows: [] }));
  let issued = 0;
  for (const r of rows) { await issueForPayment(tenant_id, r.id, { settings }); issued++; }
  return { ok: true, issued };
}

async function retry(tenant_id, id) {
  const doc = await M.updateFiscal(id, tenant_id, { retry_count: 0, status: 'pending' });
  if (!doc) return null;
  return issueForPayment(tenant_id, doc.payment_id, {});
}

module.exports = { issueForPayment, runBatch, retry };
