const express = require('express');
const router = express.Router();
const model = require('../models/vehicleMaintenanceModels');
const vehicleModel = require('../models/vehicleModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const activityLog = require('../services/activityLogService');

router.use(requireModule('locacao'));

// Sincroniza o status do veículo conforme a manutenção (§8):
//   em_andamento        → 'manutencao' (não elegível para locação);
//   concluida/cancelada → LIBERA o veículo **apenas se não houver outro bloqueio**.
//
// Outros bloqueios considerados:
//   • outra manutenção 'em_andamento' no mesmo veículo → continua indisponível;
//   • veículo 'inativo' → decisão administrativa, concluir manutenção NÃO reativa.
// Sem essas guardas, concluir uma manutenção liberava para locação um carro que
// ainda estava na oficina (ou que havia sido desativado de propósito).
async function syncVehicle(vehicle_id, maintStatus, tenantId, maintenanceId = null) {
  if (!vehicle_id) return;
  try {
    if (maintStatus === 'em_andamento') {
      await vehicleModel.setVehicleStatus(vehicle_id, 'manutencao', tenantId);
      return;
    }
    if (maintStatus !== 'concluida' && maintStatus !== 'cancelada') return;

    const veh = await vehicleModel.getVehicleById(vehicle_id, tenantId);
    if (!veh || veh.status === 'inativo') return;

    if (await model.hasBlockingMaintenance(vehicle_id, tenantId, maintenanceId)) {
      await vehicleModel.setVehicleStatus(vehicle_id, 'manutencao', tenantId);
      return;
    }
    await vehicleModel.setVehicleStatus(vehicle_id, 'disponivel', tenantId);
    // Re-deriva: volta a 'alugado' se existir locação em curso.
    await vehicleModel.refreshVehicleStatus(vehicle_id, tenantId);
  } catch (e) { console.warn('[maint] sync veículo falhou:', e.message); }
}

// GET /api/maintenances?status=&vehicle_id=
router.get('/', checkPermission('fleet:read'), async (req, res) => {
  try { res.json({ success: true, data: await model.list(req.tenantId, req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/maintenances/upcoming — próximas/vencidas
router.get('/upcoming', checkPermission('fleet:read'), async (req, res) => {
  try { res.json({ success: true, data: await model.upcomingOrOverdue(req.tenantId, req.query.days || 7) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/maintenances
router.post('/', checkPermission('fleet:update'), async (req, res) => {
  try {
    if (!req.body.vehicle_id) return res.status(400).json({ success: false, error: 'Selecione o veículo.' });
    const veh = await vehicleModel.getVehicleById(req.body.vehicle_id, req.tenantId);
    if (!veh) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });

    const maint = await model.create({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });
    await syncVehicle(maint.vehicle_id, maint.status, req.tenantId, maint.id);
    activityLog.logCreate(req.tenantId, req.userId, 'maintenance', maint.id,
      `Manutenção registrada: ${veh.brand} ${veh.model} (${maint.type || 'manutenção'})`, { vehicle_id: veh.id, status: maint.status }).catch(() => {});
    res.status(201).json({ success: true, data: maint });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/maintenances/:id
router.put('/:id', checkPermission('fleet:update'), async (req, res) => {
  try {
    const existing = await model.getById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Manutenção não encontrada' });
    const maint = await model.update(req.params.id, req.body, req.tenantId);
    await syncVehicle(maint.vehicle_id, maint.status, req.tenantId, maint.id);
    activityLog.logUpdate(req.tenantId, req.userId, 'maintenance', maint.id, 'Manutenção atualizada', existing, maint).catch(() => {});
    res.json({ success: true, data: maint });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/maintenances/:id/status
router.patch('/:id/status', checkPermission('fleet:update'), async (req, res) => {
  try {
    const existing = await model.getById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Manutenção não encontrada' });
    const maint = await model.setStatus(req.params.id, req.body.status, req.tenantId);
    await syncVehicle(maint.vehicle_id, maint.status, req.tenantId, maint.id);
    activityLog.logUpdate(req.tenantId, req.userId, 'maintenance', maint.id,
      `Status da manutenção: "${existing.status}" → "${maint.status}"`, { status: existing.status }, { status: maint.status }).catch(() => {});
    res.json({ success: true, data: maint });
  } catch (err) {
    const s = /inválido/.test(err.message) ? 400 : 500;
    res.status(s).json({ success: false, error: err.message });
  }
});

// DELETE /api/maintenances/:id
router.delete('/:id', checkPermission('fleet:delete'), async (req, res) => {
  try {
    const m = await model.remove(req.params.id, req.tenantId);
    if (!m) return res.status(404).json({ success: false, error: 'Manutenção não encontrada' });
    activityLog.logDelete(req.tenantId, req.userId, 'maintenance', req.params.id, 'Manutenção removida', m).catch(() => {});
    res.json({ success: true, data: m });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
