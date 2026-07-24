const express = require('express');
const router = express.Router();
const { parseCsv, validate, ENTITIES } = require('../services/csvImport');
const clientModel = require('../models/clientModels');
const vehicleModel = require('../models/vehicleModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');

// ============================================
// IMPORT ROUTES (§ Importação) — /api/import. Preview (sem escrita) e commit
// (insere linhas válidas, tenant-scoped, deduplicando contra o banco). Gated por
// módulo 'locacao' + permissão de criação da entidade.
// ============================================

router.use(requireModule('locacao'));

const PERM = { clientes: 'clients:create', veiculos: 'fleet:create' };
const guard = (req, res, next) => {
  const entity = req.params.entity;
  if (!ENTITIES.includes(entity)) return res.status(400).json({ success: false, error: 'Entidade inválida. Use clientes ou veiculos.' });
  return checkPermission(PERM[entity])(req, res, next);
};

const MAX_ROWS = 5000;

// POST /api/import/:entity/preview — valida sem gravar.
router.post('/:entity/preview', guard, async (req, res) => {
  try {
    const { rows } = parseCsv(req.body?.csv || '');
    if (rows.length > MAX_ROWS) return res.status(400).json({ success: false, error: `Arquivo grande demais (máx. ${MAX_ROWS} linhas).` });
    const { valid, errors } = validate(req.params.entity, rows);
    res.json({
      success: true,
      data: {
        total: rows.length, valid_count: valid.length, error_count: errors.length,
        sample: valid.slice(0, 10).map((v) => v.data),
        errors: errors.slice(0, 50),
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/import/:entity/commit — insere as linhas válidas (dedup no banco).
router.post('/:entity/commit', guard, async (req, res) => {
  try {
    const entity = req.params.entity;
    const { rows } = parseCsv(req.body?.csv || '');
    if (rows.length > MAX_ROWS) return res.status(400).json({ success: false, error: `Arquivo grande demais (máx. ${MAX_ROWS} linhas).` });
    const { valid, errors } = validate(entity, rows);

    let imported = 0, skipped = 0;
    const commitErrors = [...errors];
    for (const { line, data } of valid) {
      try {
        if (entity === 'clientes') {
          if (data.cpf && (await clientModel.getClientByCPF(data.cpf, req.tenantId))) { skipped++; continue; }
          await clientModel.createClient({ ...data, tenant_id: req.tenantId });
        } else {
          if (await vehicleModel.getVehicleByPlate(data.plate, req.tenantId)) { skipped++; continue; }
          await vehicleModel.createVehicle({ ...data, tenant_id: req.tenantId, created_by: req.userId });
        }
        imported++;
      } catch (rowErr) {
        commitErrors.push({ line, message: rowErr.message });
      }
    }
    res.json({ success: true, data: { imported, skipped, error_count: commitErrors.length, errors: commitErrors.slice(0, 50) } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
