const express = require('express');
const router = express.Router();
const model = require('../../models/serviceBillingModels');
const paymentModel = require('../../models/paymentModels');
const receiptModel = require('../../models/receiptModels');
const fineModel = require('../../models/fineModels');
const clientModel = require('../../models/clientModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const { PAYMENT_METHODS } = require('../../services/finance/constants');
const { computeBilling, deriveBillingStatus, ValidationError } = require('../../services/finance/calc');

const parsePage = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};

// GET /api/financial/billings — lista
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    const { limit, offset, page } = parsePage(req.query);
    const { rows, total } = await model.listBillings(req.tenantId, {
      ...req.query, limit, offset,
    });
    res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[finance] listar faturamentos:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar faturamentos' });
  }
});

// GET /api/financial/billings/stats — indicadores do topo (mesmos filtros da lista)
router.get('/stats', requireFinanceRead, async (req, res) => {
  try {
    const data = await model.getBillingStats(req.tenantId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] stats de faturamentos:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao calcular indicadores' });
  }
});

// GET /api/financial/billings/:id — detalhe (com pagamentos, recibos e resumo)
router.get('/:id', requireFinanceRead, async (req, res) => {
  try {
    const billing = await model.getBillingById(req.params.id, req.tenantId);
    if (!billing) return res.status(404).json({ success: false, error: 'Faturamento não encontrado' });
    const [payments, receipts] = await Promise.all([
      paymentModel.getPaymentsByBilling(req.params.id, req.tenantId),
      receiptModel.getReceiptsByBilling(req.params.id, req.tenantId),
    ]);
    res.json({ success: true, data: { ...billing, payments, receipts } });
  } catch (err) {
    console.error('[finance] obter faturamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao obter faturamento' });
  }
});

// Valida cliente/processo e devolve { client_id, fine_id } normalizados (tenant-scoped).
async function resolveLinks(req) {
  let { client_id, fine_id } = req.body;
  if (fine_id) {
    const fine = await fineModel.getFineById(fine_id, req.tenantId);
    if (!fine) throw new ValidationError('Processo (multa) inválido');
    if (!client_id) client_id = fine.client_id;
  }
  if (client_id) {
    const client = await clientModel.getClientById(client_id, req.tenantId);
    if (!client) throw new ValidationError('Cliente inválido');
  }
  if (!client_id && !fine_id) throw new ValidationError('Informe um cliente ou um processo válido');
  return { client_id: client_id || null, fine_id: fine_id || null };
}

// POST /api/financial/billings — faturar serviço/processo
router.post('/', requireFinanceManage, async (req, res) => {
  try {
    const { client_id, fine_id } = await resolveLinks(req);
    const b = req.body;
    if (b.payment_method && !PAYMENT_METHODS.includes(b.payment_method)) {
      return res.status(400).json({ success: false, error: 'Forma de pagamento inválida' });
    }
    const calc = computeBilling({
      original: b.original_amount, discount: b.discount, surcharge: b.surcharge, paid: 0,
    });
    const financial_status = deriveBillingStatus({
      finalAmount: calc.finalAmount, paidAmount: 0, dueDate: b.due_date, canceled: false,
    });
    const data = await model.createBilling({
      tenant_id: req.tenantId, client_id, company_id: b.company_id, fine_id,
      service_type_id: b.service_type_id, description: b.description,
      original_amount: b.original_amount || 0, discount: b.discount || 0, surcharge: b.surcharge || 0,
      final_amount: calc.finalAmount, paid_amount: 0,
      installments: b.installments || 1, due_date: b.due_date, payment_method: b.payment_method,
      financial_status, notes: b.notes, created_by: req.userId,
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    console.error('[finance] criar faturamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao criar faturamento' });
  }
});

// PUT /api/financial/billings/:id — editar (recalcula final e status; não mexe em pago)
router.put('/:id', requireFinanceManage, async (req, res) => {
  try {
    const existing = await model.getBillingById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Faturamento não encontrado' });
    if (existing.financial_status === 'cancelado') {
      return res.status(409).json({ success: false, error: 'Faturamento cancelado não pode ser editado' });
    }
    const b = req.body;
    if (b.payment_method && !PAYMENT_METHODS.includes(b.payment_method)) {
      return res.status(400).json({ success: false, error: 'Forma de pagamento inválida' });
    }
    const original = b.original_amount != null ? b.original_amount : existing.original_amount;
    const discount = b.discount != null ? b.discount : existing.discount;
    const surcharge = b.surcharge != null ? b.surcharge : existing.surcharge;
    const calc = computeBilling({ original, discount, surcharge, paid: existing.paid_amount, allowOverpay: true });
    const due_date = b.due_date !== undefined ? b.due_date : existing.due_date;
    const financial_status = deriveBillingStatus({
      finalAmount: calc.finalAmount, paidAmount: existing.paid_amount, dueDate: due_date, canceled: false,
    });
    const data = await model.updateBilling(req.params.id, {
      description: b.description, original_amount: original, discount, surcharge,
      final_amount: calc.finalAmount, installments: b.installments, due_date,
      payment_method: b.payment_method, financial_status, notes: b.notes,
      service_type_id: b.service_type_id,
    }, req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(err.statusCode || 400).json({ success: false, error: err.message });
    console.error('[finance] editar faturamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao editar faturamento' });
  }
});

// POST /api/financial/billings/:id/cancel — cancelar (não apaga)
router.post('/:id/cancel', requireFinanceManage, async (req, res) => {
  try {
    const existing = await model.getBillingById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Faturamento não encontrado' });
    if (Number(existing.paid_amount) > 0) {
      return res.status(409).json({ success: false, error: 'Cancele os pagamentos deste faturamento antes de cancelá-lo' });
    }
    const data = await model.cancelBilling(req.params.id, req.tenantId);
    res.json({ success: true, data, message: 'Faturamento cancelado' });
  } catch (err) {
    console.error('[finance] cancelar faturamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao cancelar faturamento' });
  }
});

module.exports = router;
