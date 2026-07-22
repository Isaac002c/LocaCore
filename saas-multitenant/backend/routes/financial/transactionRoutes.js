const express = require('express');
const router = express.Router();
const model = require('../../models/financialTransactionModels');
const categoryModel = require('../../models/financialCategoryModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const {
  TRANSACTION_TYPES, TRANSACTION_STATUSES, PAYMENT_METHODS,
} = require('../../services/finance/constants');
const { toCents } = require('../../services/finance/calc');
const activityLog = require('../../services/activityLogService');

const parsePage = (q) => {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 200);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
};

// GET /api/financial/transactions — lista filtrada e paginada
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    const { limit, offset, page } = parsePage(req.query);
    const { rows, total } = await model.listTransactions(req.tenantId, { ...req.query, limit, offset });
    res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[finance] listar lançamentos:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar lançamentos' });
  }
});

// GET /api/financial/transactions/:id
router.get('/:id', requireFinanceRead, async (req, res) => {
  try {
    const data = await model.getTransactionById(req.params.id, req.tenantId);
    if (!data) return res.status(404).json({ success: false, error: 'Lançamento não encontrado' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] obter lançamento:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao obter lançamento' });
  }
});

async function validateBody(req) {
  const { type, category_id, amount, status, payment_method } = req.body;
  if (!TRANSACTION_TYPES.includes(type)) return 'Tipo inválido (entrada/saida)';
  if (toCents(amount) < 0) return 'Valor inválido';
  if (status && !TRANSACTION_STATUSES.includes(status)) return 'Status inválido';
  if (payment_method && !PAYMENT_METHODS.includes(payment_method)) return 'Forma de pagamento inválida';
  if (category_id) {
    const cat = await categoryModel.getCategoryById(category_id, req.tenantId);
    if (!cat) return 'Categoria inválida';
    if (cat.type !== type) return 'A categoria não corresponde ao tipo do lançamento';
  }
  return null;
}

// POST /api/financial/transactions — criar lançamento manual
router.post('/', requireFinanceManage, async (req, res) => {
  try {
    const err = await validateBody(req);
    if (err) return res.status(400).json({ success: false, error: err });
    const b = req.body;
    const data = await model.createTransaction({
      tenant_id: req.tenantId,
      type: b.type, category_id: b.category_id, description: b.description,
      amount: b.amount, transaction_date: b.transaction_date, due_date: b.due_date,
      payment_method: b.payment_method, status: b.status || 'pago',
      client_id: b.client_id, fine_id: b.fine_id, notes: b.notes,
      origin: 'manual', created_by: req.userId,
    });
    // Histórico (§11) — não bloqueia a operação.
    activityLog.logCreate(req.tenantId, req.userId, 'transaction', data.id,
      `Lançamento (${data.type}) R$ ${data.amount}${data.description ? ' — ' + data.description : ''}`,
      { type: data.type, amount: data.amount, category_id: data.category_id, client_id: data.client_id, fine_id: data.fine_id }).catch(() => {});
    res.status(201).json({ success: true, data });
  } catch (e) {
    console.error('[finance] criar lançamento:', e.message);
    res.status(500).json({ success: false, error: 'Erro ao criar lançamento' });
  }
});

// PUT /api/financial/transactions/:id — editar (somente manual e não cancelado)
router.put('/:id', requireFinanceManage, async (req, res) => {
  try {
    const existing = await model.getTransactionById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Lançamento não encontrado' });
    if (existing.origin !== 'manual') {
      return res.status(409).json({ success: false, error: 'Lançamentos automáticos (de pagamento) não podem ser editados' });
    }
    if (existing.status === 'cancelado') {
      return res.status(409).json({ success: false, error: 'Lançamento cancelado não pode ser editado' });
    }
    const err = await validateBody(req);
    if (err) return res.status(400).json({ success: false, error: err });
    const data = await model.updateTransaction(req.params.id, req.body, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'transaction', req.params.id,
      `Lançamento editado (${data.type}) R$ ${data.amount}`, existing, data).catch(() => {});
    res.json({ success: true, data });
  } catch (e) {
    console.error('[finance] editar lançamento:', e.message);
    res.status(500).json({ success: false, error: 'Erro ao editar lançamento' });
  }
});

// POST /api/financial/transactions/:id/cancel — cancelar (não apaga)
router.post('/:id/cancel', requireFinanceManage, async (req, res) => {
  try {
    const existing = await model.getTransactionById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Lançamento não encontrado' });
    if (existing.origin === 'pagamento') {
      return res.status(409).json({ success: false, error: 'Cancele o pagamento correspondente para estornar este lançamento' });
    }
    const data = await model.cancelTransaction(req.params.id, req.tenantId);
    activityLog.logActivity({
      tenant_id: req.tenantId, user_id: req.userId, action: 'cancel',
      entity_type: 'transaction', entity_id: req.params.id,
      description: `Lançamento cancelado (${existing.type}) R$ ${existing.amount}`,
      metadata: { type: existing.type, amount: existing.amount },
    }).catch(() => {});
    res.json({ success: true, data, message: 'Lançamento cancelado' });
  } catch (e) {
    console.error('[finance] cancelar lançamento:', e.message);
    res.status(500).json({ success: false, error: 'Erro ao cancelar lançamento' });
  }
});

module.exports = router;
