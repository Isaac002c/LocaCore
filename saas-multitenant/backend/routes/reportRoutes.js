const express = require('express');
const router = express.Router();
const reports = require('../models/reportModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');

// ============================================
// REPORT ROUTES (§ Dashboard/Relatórios) — /api/reports. Gated por módulo
// 'locacao' + permissões reports:read / reports:export. CSV com BOM (Excel pt-BR).
// ============================================

router.use(requireModule('locacao'));

const brl = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sendCsv = (res, filename, header, rows) => {
  const lines = [header.join(';'), ...rows.map((r) => r.map(csvCell).join(';'))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n'));
};

// GET /api/reports/overview — snapshot consolidado (Painel).
router.get('/overview', checkPermission('reports:read'), async (req, res) => {
  try {
    res.json({ success: true, data: await reports.overview(req.tenantId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/revenue?from=&to=&format=csv — faturamento por período.
router.get('/revenue', checkPermission('reports:read'), async (req, res) => {
  try {
    const data = await reports.revenue(req.tenantId, { from: req.query.from, to: req.query.to });
    if (req.query.format === 'csv') {
      return sendCsv(res, `faturamento_${data.from}_${data.to}.csv`,
        ['Data', 'Locação', 'Cliente', 'Placa', 'Descrição', 'Faturado', 'Recebido', 'Status'],
        data.rows.map((r) => [String(r.data).substring(0, 10), r.rental_number, r.client_name, r.vehicle_plate, r.description, brl(r.final_amount), brl(r.paid_amount), r.financial_status]));
    }
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/rentals?from=&to=&status=&format=csv — locações por período.
router.get('/rentals', checkPermission('reports:read'), async (req, res) => {
  try {
    const data = await reports.rentalsReport(req.tenantId, { from: req.query.from, to: req.query.to, status: req.query.status });
    if (req.query.format === 'csv') {
      return sendCsv(res, 'locacoes.csv',
        ['Locação', 'Status', 'Início', 'Fim', 'Cliente', 'Placa', 'Total', 'Caução'],
        data.rows.map((r) => [r.rental_number, r.status, String(r.start_date).substring(0, 10), String(r.end_date).substring(0, 10), r.client_name, r.vehicle_plate, brl(r.total_amount), brl(r.deposit_amount)]));
    }
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/fleet — utilização da frota.
router.get('/fleet', checkPermission('reports:read'), async (req, res) => {
  try {
    res.json({ success: true, data: await reports.fleetUtilization(req.tenantId) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
