const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const model = require('../models/inventoryModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const activityLog = require('../services/activityLogService');

router.use(requireModule('locacao'));

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

// ── Itens ─────────────────────────────────────────────────────────────────────
router.get('/items', checkPermission('inventory:read'), async (req, res) => {
  try {
    const { q = '', category = '', active = '', limit, offset } = req.query;
    if (limit !== undefined) {
      const r = await model.listItems(req.tenantId, { q, category, active, limit, offset });
      return res.json({ success: true, data: r.rows, pagination: { limit: r.limit, offset: r.offset, total: r.total, total_pages: Math.ceil(r.total / r.limit) } });
    }
    res.json({ success: true, data: await model.listItems(req.tenantId, { q, category, active }) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/dashboard', checkPermission('inventory:read'), async (req, res) => {
  try { res.json({ success: true, data: await model.dashboard(req.tenantId) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/export', checkPermission('inventory:read'), async (req, res) => {
  try {
    const items = await model.listItems(req.tenantId, {});
    const head = ['Nome', 'Código', 'Categoria', 'Unidade', 'Quantidade', 'Mínimo', 'Custo unit.', 'Local', 'Ativo'];
    const lines = [head.map(csvCell).join(',')];
    for (const i of items) lines.push([i.name, i.code, i.category, i.unit, i.quantity, i.min_quantity, i.unit_cost, i.location, i.active ? 'sim' : 'não'].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="estoque.csv"');
    res.send('﻿' + lines.join('\n'));
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/items', checkPermission('inventory:manage'), async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    const item = await model.createItem({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });
    activityLog.logCreate(req.tenantId, req.userId, 'inventory_item', item.id, `Item de estoque: ${item.name}`, {}).catch(() => {});
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (/uq_inv_items_code|unique/i.test(err.message)) return res.status(409).json({ success: false, error: 'Já existe item com este código.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/items/:id', checkPermission('inventory:manage'), async (req, res) => {
  try {
    const item = await model.updateItem(req.params.id, req.body, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });
    res.json({ success: true, data: item });
  } catch (err) {
    if (/uq_inv_items_code|unique/i.test(err.message)) return res.status(409).json({ success: false, error: 'Código já usado.' });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/items/:id', checkPermission('inventory:manage'), async (req, res) => {
  try {
    const mov = await pool.query('SELECT COUNT(*)::int AS n FROM inventory_movements WHERE item_id=$1 AND tenant_id=$2', [req.params.id, req.tenantId]);
    if (mov.rows[0].n > 0) return res.status(409).json({ success: false, error: 'Item com movimentações. Inative-o em vez de excluir.' });
    const item = await model.deleteItem(req.params.id, req.tenantId);
    if (!item) return res.status(404).json({ success: false, error: 'Item não encontrado' });
    activityLog.logDelete(req.tenantId, req.userId, 'inventory_item', req.params.id, `Item removido: ${item.name}`, item).catch(() => {});
    res.json({ success: true, data: item });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Movimentações ─────────────────────────────────────────────────────────────
router.get('/items/:id/movements', checkPermission('inventory:read'), async (req, res) => {
  try {
    const r = await model.listMovements(req.tenantId, { item_id: req.params.id, limit: req.query.limit, offset: req.query.offset });
    res.json({ success: true, data: r.rows, pagination: { limit: r.limit, offset: r.offset, total: r.total, total_pages: Math.ceil(r.total / r.limit) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/movements', checkPermission('inventory:read'), async (req, res) => {
  try {
    const r = await model.listMovements(req.tenantId, { item_id: req.query.item_id, limit: req.query.limit, offset: req.query.offset });
    res.json({ success: true, data: r.rows, pagination: { limit: r.limit, offset: r.offset, total: r.total, total_pages: Math.ceil(r.total / r.limit) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/movements', checkPermission('inventory:manage'), async (req, res) => {
  try {
    if (!req.body.item_id) return res.status(400).json({ success: false, error: 'Item é obrigatório' });
    const r = await model.createMovement({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });
    activityLog.logGeneric(req.tenantId, req.userId, 'create', 'inventory_movement',
      `Movimentação ${req.body.type} — ${r.item.name || ''} (saldo ${r.movement.balance_after})`, { item_id: req.body.item_id, type: req.body.type }).catch(() => {});
    res.status(201).json({ success: true, data: r });
  } catch (err) {
    const s = err.statusCode || (/inválid|maior que zero/.test(err.message) ? 400 : 500);
    res.status(s).json({ success: false, error: err.message });
  }
});

module.exports = router;
