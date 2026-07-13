const express = require('express');
const router  = express.Router();
const model   = require('../models/approvalModels');

// Verificação inline de role admin
const requireAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Apenas administradores podem realizar esta ação' });
  }
  next();
};

// POST /api/approvals — qualquer usuário autenticado pode solicitar exclusão
router.post('/', async (req, res) => {
  try {
    const item = await model.create({
      tenant_id:    req.tenantId,
      requested_by: req.userId,
      target_type:  req.body.target_type,
      target_id:    req.body.target_id,
      target_label: req.body.target_label,
      reason:       req.body.reason,
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/approvals — somente admin
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const data = await model.listByTenant(req.tenantId, status || null);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/approvals/:id/approve — somente admin
router.patch('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const item = await model.approve(req.params.id, req.userId, req.tenantId);
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/approvals/:id/reject — somente admin
router.patch('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const item = await model.reject(req.params.id, req.userId, req.tenantId);
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
