const express = require('express');
const router = express.Router();
const model = require('../models/configOptionModels');
const { requireAdmin } = require('../middlewares/checkPermission');

// ============================================
// CONFIG OPTIONS — listas parametrizáveis por tenant (§2.3/§6/§8).
// Leitura: qualquer usuário autenticado do tenant (para dropdowns).
// Escrita: admin. Tenant sempre do token.
// ============================================

const ALLOWED_KINDS = ['vehicle_category', 'rental_extra_category'];
const badKind = (res) => res.status(400).json({ success: false, error: 'Tipo de lista inválido.' });
const isDupe = (err) => /uq_tenant_config_options|unique/i.test(err.message || '');

// GET /api/config-options?kind=vehicle_category[&all=1]
router.get('/', async (req, res) => {
  try {
    const kind = String(req.query.kind || '');
    if (!ALLOWED_KINDS.includes(kind)) return badKind(res);
    // Semeia os padrões na primeira consulta (idempotente).
    if (model.DEFAULTS[kind]) await model.ensureDefaults(req.tenantId, kind, model.DEFAULTS[kind]).catch(() => {});
    const includeInactive = String(req.query.all || '') === '1';
    const rows = await model.listOptions(req.tenantId, kind, { includeInactive });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Erro ao listar opções:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao listar opções' });
  }
});

// POST /api/config-options  (admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { kind, value, sort_order } = req.body;
    if (!ALLOWED_KINDS.includes(kind)) return badKind(res);
    if (!value || !String(value).trim()) return res.status(400).json({ success: false, error: 'Informe um valor.' });
    const opt = await model.createOption({ tenant_id: req.tenantId, kind, value, sort_order });
    res.status(201).json({ success: true, data: opt });
  } catch (err) {
    if (isDupe(err)) return res.status(409).json({ success: false, error: 'Este item já existe.' });
    console.error('Erro ao criar opção:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao criar opção' });
  }
});

// PUT /api/config-options/:id  (admin) — editar/ordenar/ativar/desativar
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await model.getOptionById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Opção não encontrada' });
    const opt = await model.updateOption(req.params.id, req.body, req.tenantId);
    res.json({ success: true, data: opt });
  } catch (err) {
    if (isDupe(err)) return res.status(409).json({ success: false, error: 'Este item já existe.' });
    console.error('Erro ao atualizar opção:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar opção' });
  }
});

module.exports = router;
