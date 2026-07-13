const express = require('express');
const router = express.Router();
const receiptModel = require('../../models/receiptModels');
const paymentModel = require('../../models/paymentModels');
const clientModel = require('../../models/clientModels');
const fineModel = require('../../models/fineModels');
const userModel = require('../../models/userModels');
const tenantModel = require('../../models/tenantModels');
const settingsModel = require('../../models/tenantFinancialSettingsModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const receiptService = require('../../services/finance/receiptService');
const { resolveBranding } = require('../../services/finance/branding');
const { buildReceiptPdf } = require('../../services/finance/pdfService');
const { ValidationError } = require('../../services/finance/calc');

const parsePage = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};

// Reúne dados de snapshot (cliente, serviço) e defaults de branding para emissão.
async function buildIssueInput(req, body) {
  const payment = await paymentModel.getPaymentById(body.payment_id, req.tenantId);
  if (!payment) throw new ValidationError('Pagamento não encontrado');
  if (payment.status === 'cancelado') throw new ValidationError('Pagamento cancelado não gera recibo');

  let client = null;
  const clientId = body.client_id || payment.client_id;
  if (clientId) client = await clientModel.getClientById(clientId, req.tenantId);

  let fine = null;
  const fineId = body.fine_id || payment.fine_id;
  if (fineId) fine = await fineModel.getFineById(fineId, req.tenantId);

  const [settings, tenant, user] = await Promise.all([
    settingsModel.ensureSettings(req.tenantId),
    tenantModel.getTenantById(req.tenantId),
    userModel.getUserById(req.userId, req.tenantId).catch(() => null),
  ]);
  const branding = resolveBranding({ tenant, settings });

  const service = body.service_description
    || (fine ? `Serviço referente ao processo ${fine.fine_number || fine.organ || ''}`.trim() : null)
    || 'Prestação de serviço';

  return {
    tenant_id: req.tenantId,
    payment_id: body.payment_id,
    billing_id: body.billing_id || payment.billing_id || null,
    fine_id: fineId || null,
    client_id: clientId || null,
    client_name: body.client_name || (client && client.name) || 'Cliente',
    client_document: body.client_document || (client && client.cpf) || null,
    service_description: service,
    amount: payment.amount,
    payment_method: payment.payment_method,
    notes: body.notes || null,
    created_by: req.userId,
    created_by_name: user ? user.name : (req.userEmail || null),
    defaultIssuerName: branding.name,
    defaultIssuerDocument: branding.document,
    defaultIssuerAddress: branding.address,
    defaultPrefix: settings.receipt_prefix,
  };
}

// GET /api/financial/receipts — lista (inclui cancelados no histórico)
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    const { limit, offset, page } = parsePage(req.query);
    const { rows, total } = await receiptModel.listReceipts(req.tenantId, { ...req.query, limit, offset });
    res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[finance] listar recibos:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar recibos' });
  }
});

// GET /api/financial/receipts/:id
router.get('/:id', requireFinanceRead, async (req, res) => {
  try {
    const data = await receiptModel.getReceiptById(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Recibo não encontrado' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] obter recibo:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao obter recibo' });
  }
});

// GET /api/financial/receipts/:id/pdf — PDF (A4, pronto p/ impressão)
router.get('/:id/pdf', requireFinanceRead, async (req, res) => {
  try {
    const receipt = await receiptModel.getReceiptById(req.params.id, req.tenantId);
    if (!receipt) return res.status(404).json({ success: false, error: 'Recibo não encontrado' });

    const [settings, tenant] = await Promise.all([
      settingsModel.getSettings(req.tenantId),
      tenantModel.getTenantById(req.tenantId),
    ]);
    const branding = resolveBranding({ tenant, settings, receipt });

    let pdf;
    try {
      pdf = await buildReceiptPdf(receipt, branding);
    } catch (e) {
      if (e && (e.code === 'MODULE_NOT_FOUND' || /pdfkit/i.test(e.message))) {
        return res.status(503).json({ success: false, error: 'Geração de PDF indisponível (dependência pdfkit não instalada)' });
      }
      throw e;
    }

    const download = String(req.query.download || '') === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="recibo-${receipt.full_number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err) {
    console.error('[finance] pdf recibo:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao gerar PDF do recibo' });
  }
});

// POST /api/financial/receipts — emitir recibo
router.post('/', requireFinanceManage, async (req, res) => {
  try {
    if (!req.body.payment_id) return res.status(400).json({ success: false, error: 'Pagamento é obrigatório' });
    const input = await buildIssueInput(req, req.body);
    const receipt = await receiptService.issueReceipt(input);
    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    const status = err.statusCode || (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[finance] emitir recibo:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao emitir recibo' : err.message });
  }
});

// POST /api/financial/receipts/:id/cancel — cancelar (mantém no histórico)
router.post('/:id/cancel', requireFinanceManage, async (req, res) => {
  try {
    const data = await receiptService.cancelReceipt(req.params.id, {
      tenant_id: req.tenantId, reason: req.body.reason,
    });
    res.json({ success: true, data, message: 'Recibo cancelado' });
  } catch (err) {
    const status = err.statusCode || (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[finance] cancelar recibo:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao cancelar recibo' : err.message });
  }
});

// POST /api/financial/receipts/:id/reissue — reemitir (cancela atual + novo número)
router.post('/:id/reissue', requireFinanceManage, async (req, res) => {
  try {
    const old = await receiptModel.getReceiptById(req.params.id, req.tenantId);
    if (!old) return res.status(404).json({ success: false, error: 'Recibo não encontrado' });
    // Reaproveita os dados de snapshot + branding atualizada.
    const input = await buildIssueInput(req, {
      payment_id: old.payment_id,
      billing_id: old.billing_id,
      fine_id: old.fine_id,
      client_id: old.client_id,
      client_name: old.client_name,
      client_document: old.client_document,
      service_description: old.service_description,
      notes: old.notes,
    });
    const receipt = await receiptService.reissueReceipt(req.params.id, { ...input, reason: req.body.reason });
    res.status(201).json({ success: true, data: receipt });
  } catch (err) {
    const status = err.statusCode || (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[finance] reemitir recibo:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao reemitir recibo' : err.message });
  }
});

module.exports = router;
