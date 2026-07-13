const express = require('express');
const router = express.Router();
const model = require('../../models/financialCategoryModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const { TRANSACTION_TYPES } = require('../../services/finance/constants');

// GET /api/financial/categories — lista (semeia defaults na 1ª vez)
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    await model.ensureDefaultCategories(req.tenantId);
    const { type, active } = req.query;
    const data = await model.listCategories(req.tenantId, { type, active });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] listar categorias:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar categorias' });
  }
});

// POST /api/financial/categories — criar
router.post('/', requireFinanceManage, async (req, res) => {
  try {
    const { name, type, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    if (!TRANSACTION_TYPES.includes(type)) return res.status(400).json({ success: false, error: 'Tipo inválido (entrada/saida)' });
    const data = await model.createCategory({ tenant_id: req.tenantId, name: name.trim(), type, description });
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, error: 'Já existe uma categoria com esse nome e tipo' });
    console.error('[finance] criar categoria:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao criar categoria' });
  }
});

// PUT /api/financial/categories/:id — editar
router.put('/:id', requireFinanceManage, async (req, res) => {
  try {
    const { name, type, description, active } = req.body;
    if (type && !TRANSACTION_TYPES.includes(type)) return res.status(400).json({ success: false, error: 'Tipo inválido' });
    const existing = await model.getCategoryById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Categoria não encontrada' });
    const data = await model.updateCategory(req.params.id, { name, type, description, active }, req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, error: 'Já existe uma categoria com esse nome e tipo' });
    console.error('[finance] editar categoria:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao editar categoria' });
  }
});

// PATCH /api/financial/categories/:id/active — ativar/inativar
router.patch('/:id/active', requireFinanceManage, async (req, res) => {
  try {
    const active = req.body.active === true || req.body.active === 'true';
    const existing = await model.getCategoryById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Categoria não encontrada' });
    const data = await model.setActive(req.params.id, active, req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] ativar categoria:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao alterar status da categoria' });
  }
});

// DELETE /api/financial/categories/:id — só se não houver lançamentos vinculados
router.delete('/:id', requireFinanceManage, async (req, res) => {
  try {
    const existing = await model.getCategoryById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Categoria não encontrada' });
    const count = await model.countTransactions(req.params.id, req.tenantId);
    if (count > 0) {
      return res.status(409).json({ success: false, error: 'Categoria possui lançamentos vinculados. Inative-a em vez de excluir.' });
    }
    await model.deleteCategory(req.params.id, req.tenantId);
    res.json({ success: true, message: 'Categoria excluída' });
  } catch (err) {
    console.error('[finance] excluir categoria:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao excluir categoria' });
  }
});

module.exports = router;
