const express = require('express');
const router = express.Router();
const vehicleModel = require('../models/vehicleModels');
const rentalModel = require('../models/rentalModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const activityLog = require('../services/activityLogService');

// ============================================
// FROTA (vehicles) — LocaCore. Tenant via req.tenantId (tenantContext global).
// Gating de módulo (§12/§15) + permissões: leitura para todos; escrita gated por fleet:*.
// ============================================

// Todo o módulo exige que o tenant tenha "locacao" habilitado.
router.use(requireModule('locacao'));

// GET /api/vehicles — lista (filtros: status, q)
router.get('/', checkPermission('fleet:read'), async (req, res) => {
  try {
    const { status = '', q = '' } = req.query;
    const vehicles = await vehicleModel.getAllVehicles(req.tenantId, { status, q });
    res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error('Erro ao listar veículos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vehicles/available — veículos disponíveis para locação
router.get('/available', checkPermission('fleet:read'), async (req, res) => {
  try {
    const vehicles = await vehicleModel.getAvailableVehicles(req.tenantId);
    res.json({ success: true, data: vehicles });
  } catch (err) {
    console.error('Erro ao listar veículos disponíveis:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vehicles/stats — indicadores da frota
router.get('/stats', checkPermission('fleet:read'), async (req, res) => {
  try {
    const stats = await vehicleModel.getFleetStats(req.tenantId);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('Erro ao buscar stats da frota:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vehicles/:id — detalhe
router.get('/:id', checkPermission('fleet:read'), async (req, res) => {
  try {
    const vehicle = await vehicleModel.getVehicleById(req.params.id, req.tenantId);
    if (!vehicle) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });
    res.json({ success: true, data: vehicle });
  } catch (err) {
    console.error('Erro ao buscar veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vehicles/:id/rentals — locações deste veículo (histórico)
router.get('/:id/rentals', checkPermission('fleet:read'), async (req, res) => {
  try {
    const vehicle = await vehicleModel.getVehicleById(req.params.id, req.tenantId);
    if (!vehicle) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });
    const rentals = await rentalModel.getRentalsByVehicle(req.params.id, req.tenantId);
    res.json({ success: true, data: rentals });
  } catch (err) {
    console.error('Erro ao listar locações do veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Validação compartilhada (create/update). Placa opcional; quando presente,
// deve ser única no tenant. daily_rate/odometer não podem ser negativos.
const validate = (body) => {
  if (!body.brand || !String(body.brand).trim()) return 'Marca é obrigatória.';
  if (!body.model || !String(body.model).trim()) return 'Modelo é obrigatório.';
  if (body.daily_rate !== undefined && Number(body.daily_rate) < 0) return 'Diária não pode ser negativa.';
  if (body.year && (Number(body.year) < 1900 || Number(body.year) > new Date().getFullYear() + 1)) return 'Ano inválido.';
  return null;
};

// POST /api/vehicles — criar veículo
router.post('/', checkPermission('fleet:create'), async (req, res) => {
  try {
    const v = validate(req.body);
    if (v) return res.status(400).json({ success: false, error: v });

    if (req.body.plate) {
      const existing = await vehicleModel.getVehicleByPlate(req.body.plate, req.tenantId);
      if (existing) return res.status(400).json({ success: false, error: 'Já existe um veículo com esta placa.' });
    }

    const vehicle = await vehicleModel.createVehicle({ ...req.body, tenant_id: req.tenantId, created_by: req.userId });

    activityLog.logCreate(req.tenantId, req.userId, 'vehicle', vehicle.id,
      `Veículo cadastrado: ${vehicle.brand} ${vehicle.model}${vehicle.plate ? ` (${vehicle.plate})` : ''}`,
      { plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model, daily_rate: vehicle.daily_rate }).catch(() => {});

    res.status(201).json({ success: true, data: vehicle });
  } catch (err) {
    console.error('Erro ao criar veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/vehicles/:id — atualizar veículo
router.put('/:id', checkPermission('fleet:update'), async (req, res) => {
  try {
    const existing = await vehicleModel.getVehicleById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });

    const v = validate({ ...existing, ...req.body });
    if (v) return res.status(400).json({ success: false, error: v });

    // Dedupe de placa contra OUTRO veículo
    if (req.body.plate && String(req.body.plate).toUpperCase() !== String(existing.plate || '').toUpperCase()) {
      const dupe = await vehicleModel.getVehicleByPlate(req.body.plate, req.tenantId);
      if (dupe && dupe.id !== existing.id) return res.status(400).json({ success: false, error: 'Placa já usada por outro veículo.' });
    }

    const vehicle = await vehicleModel.updateVehicle(req.params.id, req.body, req.tenantId);

    activityLog.logUpdate(req.tenantId, req.userId, 'vehicle', vehicle.id,
      `Veículo atualizado: ${vehicle.brand} ${vehicle.model}`, existing, vehicle).catch(() => {});

    res.json({ success: true, data: vehicle });
  } catch (err) {
    console.error('Erro ao atualizar veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/vehicles/:id/status — alterar status (disponivel/alugado/manutencao/inativo)
router.patch('/:id/status', checkPermission('fleet:update'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!vehicleModel.STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Status inválido.' });
    }
    const existing = await vehicleModel.getVehicleById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });

    const vehicle = await vehicleModel.setVehicleStatus(req.params.id, status, req.tenantId);

    activityLog.logUpdate(req.tenantId, req.userId, 'vehicle', vehicle.id,
      `Status do veículo alterado para "${status}"`, { status: existing.status }, { status }).catch(() => {});

    res.json({ success: true, data: vehicle });
  } catch (err) {
    console.error('Erro ao alterar status do veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/vehicles/:id — excluir (bloqueado se houver locação ativa → oriente inativar)
router.delete('/:id', checkPermission('fleet:delete'), async (req, res) => {
  try {
    const existing = await vehicleModel.getVehicleById(req.params.id, req.tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Veículo não encontrado' });

    const active = await vehicleModel.countActiveRentals(req.params.id, req.tenantId);
    if (active > 0) {
      return res.status(409).json({ success: false, error: 'Veículo possui locações ativas. Marque como "inativo" em vez de excluir.' });
    }

    const vehicle = await vehicleModel.deleteVehicle(req.params.id, req.tenantId);

    activityLog.logDelete(req.tenantId, req.userId, 'vehicle', req.params.id,
      `Veículo removido: ${vehicle.brand} ${vehicle.model}`, vehicle).catch(() => {});

    res.json({ success: true, data: vehicle, message: 'Veículo excluído.' });
  } catch (err) {
    console.error('Erro ao excluir veículo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
