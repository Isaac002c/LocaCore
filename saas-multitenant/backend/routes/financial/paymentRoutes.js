const express = require('express');
const router = express.Router();
const paymentModel = require('../../models/paymentModels');
const categoryModel = require('../../models/financialCategoryModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const { PAYMENT_METHODS } = require('../../services/finance/constants');
const { toCents, ValidationError } = require('../../services/finance/calc');
const paymentService = require('../../services/finance/paymentService');

const parsePage = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};

// GET /api/financial/payments — lista
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    const { limit, offset, page } = parsePage(req.query);
    const { rows, total } = await paymentModel.listPayments(req.tenantId, { ...req.query, limit, offset });
    res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[finance] listar pagamentos:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar pagamentos' });
  }
});

// GET /api/financial/payments/:id
router.get('/:id', requireFinanceRead, async (req, res) => {
  try {
    const data = await paymentModel.getPaymentById(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Pagamento não encontrado' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] obter pagamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao obter pagamento' });
  }
});

// Escolhe a categoria de entrada para a entrada automática de Caixa.
async function resolveEntryCategory(tenantId, { is_deposit, installments_total }) {
  await categoryModel.ensureDefaultCategories(tenantId);
  let name = 'Pagamento de serviço';
  if (is_deposit) name = 'Sinal';
  else if (parseInt(installments_total, 10) > 1) name = 'Parcela';
  const cat = await categoryModel.findByName(tenantId, name, 'entrada')
    || await categoryModel.findByName(tenantId, 'Pagamento de serviço', 'entrada');
  return cat ? cat.id : null;
}

// POST /api/financial/payments — registrar/confirmar pagamento (total, parcial, sinal, parcela)
router.post('/', requireFinanceManage, async (req, res) => {
  try {
    const b = req.body;
    if (toCents(b.amount) <= 0) return res.status(400).json({ success: false, error: 'Valor do pagamento deve ser maior que zero' });
    if (b.payment_method && !PAYMENT_METHODS.includes(b.payment_method)) {
      return res.status(400).json({ success: false, error: 'Forma de pagamento inválida' });
    }
    if (!b.billing_id && !b.client_id && !b.fine_id) {
      return res.status(400).json({ success: false, error: 'Vincule o pagamento a um faturamento, cliente ou processo' });
    }

    const category_id = await resolveEntryCategory(req.tenantId, b);

    const result = await paymentService.confirmPayment({
      tenant_id: req.tenantId,
      billing_id: b.billing_id || null,
      client_id: b.client_id || null,
      fine_id: b.fine_id || null,
      amount: b.amount,
      payment_date: b.payment_date || null,
      payment_method: b.payment_method || null,
      installment_number: b.installment_number || 1,
      installments_total: b.installments_total || 1,
      is_deposit: b.is_deposit || false,
      notes: b.notes || null,
      allowOverpay: b.allowOverpay === true,
      category_id,
      entry_description: b.entry_description || 'Recebimento de pagamento',
      created_by: req.userId,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.statusCode || (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[finance] registrar pagamento:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao registrar pagamento' : err.message });
  }
});

// POST /api/financial/payments/:id/cancel — cancelar pagamento (estorno lógico)
router.post('/:id/cancel', requireFinanceManage, async (req, res) => {
  try {
    const result = await paymentService.cancelPayment(req.params.id, {
      tenant_id: req.tenantId, reason: req.body.reason,
    });
    res.json({ success: true, data: result, message: 'Pagamento cancelado' });
  } catch (err) {
    const status = err.statusCode || (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error('[finance] cancelar pagamento:', err.message);
    res.status(status).json({ success: false, error: status >= 500 ? 'Erro ao cancelar pagamento' : err.message });
  }
});

module.exports = router;
