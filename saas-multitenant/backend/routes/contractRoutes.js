const express = require('express');
const router = express.Router();
const contractModel = require('../models/contractModels');
const companyModel = require('../models/companyModels');
const vehicleModel = require('../models/companyVehicleModels');
const { checkPermission, requireAdmin } = require('../middlewares/checkPermission');

const plateKey = (p) => String(p || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

// Valida vínculo empresa/veículo de um processo contra o tenant autenticado.
// Só atua quando company_id/vehicle_id são informados (não afeta o fluxo de cliente).
async function validateContractLink(body, tenantId) {
  const { company_id, vehicle_id, vehicle_plate } = body;
  if (!company_id && !vehicle_id) return { ok: true };

  if (company_id) {
    const company = await companyModel.getCompanyById(company_id, tenantId);
    if (!company) return { ok: false, status: 400, error: 'Empresa inválida para este tenant' };
  }
  if (vehicle_id) {
    const vehicle = await vehicleModel.getById(vehicle_id, tenantId);
    if (!vehicle) return { ok: false, status: 400, error: 'Veículo inválido para este tenant' };
    if (company_id && vehicle.company_id !== company_id) {
      return { ok: false, status: 400, error: 'Veículo não pertence à empresa informada' };
    }
    // Coerência de placa: quando o veículo tem placa e o processo informa outra, bloqueia.
    if (vehicle.plate && vehicle_plate && plateKey(vehicle.plate) !== plateKey(vehicle_plate)) {
      return { ok: false, status: 400, error: 'Placa informada não corresponde ao veículo selecionado' };
    }
  }
  return { ok: true };
}

// GET /api/contracts/stage-clients — clientes agrupados por macro-etapa
router.get('/stage-clients', checkPermission('contracts:read'), async (req, res) => {
  try {
    const rows = await contractModel.getClientsByStageGroup(req.tenantId);
    // Agrupa por sub_group
    const groups = {};
    for (const r of rows) {
      if (!r.sub_group) continue;
      if (!groups[r.sub_group]) groups[r.sub_group] = [];
      groups[r.sub_group].push(r);
    }
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/aprs-stats', checkPermission('contracts:read'), async (req, res) => {
  try {
    const stats = await contractModel.getAPRsByStage(req.tenantId);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/by-organ', checkPermission('contracts:read'), async (req, res) => {
  try {
    const data = await contractModel.getContractsGroupedByOrgan(req.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/dashboard', checkPermission('contracts:read'), async (req, res) => {
  try {
    const [dashboard, alerts] = await Promise.all([
      contractModel.getDashboardStats(req.tenantId),
      contractModel.getAlerts(req.tenantId),
    ]);
    res.json({ success: true, data: { dashboard, alerts } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/contracts/deadlines?days=30 — prazos vencidos + próximos (escopo do tenant autenticado)
router.get('/deadlines', checkPermission('contracts:read'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const [overdue, upcoming] = await Promise.all([
      contractModel.getOverdueContracts(req.tenantId),
      contractModel.getContractsNearDueDate(req.tenantId, days),
    ]);
    res.json({ success: true, data: { overdue, upcoming, days } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/contracts/deferred — processos DEFERIDOS (cliente OU empresa), tenant-scoped
router.get('/deferred', checkPermission('contracts:read'), async (req, res) => {
  try {
    const rows = await contractModel.getDeferred(req.tenantId);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/client/:clientId', checkPermission('contracts:read'), async (req, res) => {
  try {
    const contracts = await contractModel.getContractsByClient(req.params.clientId, req.tenantId);
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/service/:serviceId', checkPermission('contracts:read'), async (req, res) => {
  try {
    const contracts = await contractModel.getContractsByService(
      req.params.serviceId,
      req.tenantId,
      req.query.client_id || null
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const contracts = await contractModel.getAllContracts(req.tenantId);
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/', checkPermission('contracts:create'), async (req, res) => {
  try {
    const linkCheck = await validateContractLink(req.body, req.tenantId);
    if (!linkCheck.ok) return res.status(linkCheck.status).json({ success: false, error: linkCheck.error });
    const contract = await contractModel.createContract({ ...req.body, tenant_id: req.tenantId });
    res.status(201).json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/:id', checkPermission('contracts:update'), async (req, res) => {
  try {
    const linkCheck = await validateContractLink(req.body, req.tenantId);
    if (!linkCheck.ok) return res.status(linkCheck.status).json({ success: false, error: linkCheck.error });
    const contract = await contractModel.updateContract(req.params.id, req.body, req.tenantId);
    if (!contract) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/contracts/:id/protocol — atualiza apenas campos de protocolo
router.patch('/:id/protocol', checkPermission('contracts:update'), async (req, res) => {
  try {
    const contract = await contractModel.patchContractProtocol(req.params.id, req.body, req.tenantId);
    if (!contract) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', checkPermission('contracts:delete'), async (req, res) => {
  try {
    const contract = await contractModel.deleteContract(req.params.id, req.tenantId);
    if (!contract) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:id', checkPermission('contracts:read'), async (req, res) => {
  try {
    const contract = await contractModel.getContractById(req.params.id, req.tenantId);
    if (!contract) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: contract });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;