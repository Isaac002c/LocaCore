const express = require('express');
const router = express.Router();
const model = require('../models/rentalFineModels');
const billingModel = require('../models/serviceBillingModels');
const rentalModel = require('../models/rentalModels');
const rentalService = require('../services/rentalService');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const activityLog = require('../services/activityLogService');

router.use(requireModule('locacao'));

// GET /api/rental-fines?status=&rental_id=&vehicle_id=&client_id=&q=&limit=&offset=
router.get('/', checkPermission('rental_fines:read'), async (req, res) => {
  try {
    const { status = '', rental_id = '', vehicle_id = '', client_id = '', q = '', limit, offset } = req.query;
    const filters = { status, rental_id, vehicle_id, client_id, q };
    if (limit !== undefined) {
      const r = await model.list(req.tenantId, filters, { limit, offset });
      return res.json({ success: true, data: r.rows, pagination: { limit: r.limit, offset: r.offset, total: r.total, total_pages: Math.ceil(r.total / r.limit) } });
    }
    res.json({ success: true, data: await model.list(req.tenantId, filters) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/stats', checkPermission('rental_fines:read'), async (req, res) => {
  try { res.json({ success: true, data: await model.stats(req.tenantId) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/:id', checkPermission('rental_fines:read'), async (req, res) => {
  try {
    const f = await model.getById(req.params.id, req.tenantId);
    if (!f) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    res.json({ success: true, data: f });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const fine = await model.create({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });
    activityLog.logCreate(req.tenantId, req.userId, 'rental_fine', fine.id,
      `Multa registrada: ${fine.fine_number || '(s/nº)'} — ${fine.organ || ''}`, { total: fine.total_amount, status: fine.status }).catch(() => {});
    res.status(201).json({ success: true, data: fine });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.put('/:id', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const existing = await model.getById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    const fine = await model.update(req.params.id, req.body, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental_fine', fine.id, 'Multa atualizada', existing, fine).catch(() => {});
    res.json({ success: true, data: fine });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.patch('/:id/status', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const existing = await model.getById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    const fine = await model.setStatus(req.params.id, req.body.status, req.tenantId);
    activityLog.logUpdate(req.tenantId, req.userId, 'rental_fine', fine.id, `Status da multa → "${fine.status}"`, { status: existing.status }, { status: fine.status }).catch(() => {});
    res.json({ success: true, data: fine });
  } catch (err) { res.status(/inválido/.test(err.message) ? 400 : 500).json({ success: false, error: err.message }); }
});

// POST /:id/faturar — transforma a multa em faturamento (evita duplicidade)
router.post('/:id/faturar', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const fine = await model.getById(req.params.id, req.tenantId);
    if (!fine) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    if (fine.billing_id) return res.status(409).json({ success: false, error: 'Multa já faturada.' });
    const amount = Number(fine.total_amount) || 0;
    const billing = await billingModel.createBilling({
      tenant_id: req.tenantId, client_id: fine.client_id, rental_id: fine.rental_id,
      description: `Multa ${fine.fine_number || ''}${fine.vehicle_plate ? ` — ${fine.vehicle_plate}` : ''}`.trim(),
      original_amount: amount, discount: 0, surcharge: 0, final_amount: amount, paid_amount: 0,
      installments: 1, due_date: fine.due_date || null, financial_status: 'faturado', created_by: req.userId,
    });
    const updated = await model.setBilling(req.params.id, billing.id, req.tenantId);
    activityLog.logGeneric(req.tenantId, req.userId, 'create', 'billing',
      `Faturamento de multa ${fine.fine_number || ''} (R$ ${amount.toFixed(2)})`, { rental_fine_id: fine.id, billing_id: billing.id }).catch(() => {});
    res.status(201).json({ success: true, data: { fine: updated, billing } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /:id/adicional — transforma a multa em adicional da locação vinculada
router.post('/:id/adicional', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const fine = await model.getById(req.params.id, req.tenantId);
    if (!fine) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    if (!fine.rental_id) return res.status(400).json({ success: false, error: 'Multa sem locação vinculada.' });
    if (fine.rental_extra_id) return res.status(409).json({ success: false, error: 'Multa já lançada como adicional.' });
    const { extra } = await rentalService.addExtra(fine.rental_id, {
      category: 'Multa', description: `Multa ${fine.fine_number || ''}`.trim(), quantity: 1, unit_amount: fine.total_amount, created_by: req.userId,
    }, req.tenantId);
    const updated = await model.setExtra(req.params.id, extra.id, req.tenantId);
    activityLog.logGeneric(req.tenantId, req.userId, 'create', 'rental_extra',
      `Multa ${fine.fine_number || ''} lançada como adicional`, { rental_fine_id: fine.id, extra_id: extra.id }).catch(() => {});
    res.status(201).json({ success: true, data: { fine: updated, extra } });
  } catch (err) {
    const s = err.statusCode || 500;
    res.status(s).json({ success: false, error: s >= 500 ? 'Erro ao lançar adicional' : err.message });
  }
});

// DELETE /:id — bloqueado se houver vínculo financeiro (§4)
router.delete('/:id', checkPermission('rental_fines:manage'), async (req, res) => {
  try {
    const fine = await model.getById(req.params.id, req.tenantId);
    if (!fine) return res.status(404).json({ success: false, error: 'Multa não encontrada' });
    if (fine.billing_id || fine.rental_extra_id) return res.status(409).json({ success: false, error: 'Multa com vínculo financeiro. Cancele-a em vez de excluir.' });
    const removed = await model.remove(req.params.id, req.tenantId);
    activityLog.logDelete(req.tenantId, req.userId, 'rental_fine', req.params.id, `Multa removida: ${fine.fine_number || ''}`, fine).catch(() => {});
    res.json({ success: true, data: removed });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
