const express = require('express');
const router = express.Router();
const billingModel = require('../../models/serviceBillingModels');
const paymentModel = require('../../models/paymentModels');
const receiptModel = require('../../models/receiptModels');
const txModel = require('../../models/financialTransactionModels');
const reportModel = require('../../models/financeReportModels');
const { requireFinanceRead } = require('../../middlewares/financeAccess');
const { getWeekRange, getMonthRange } = require('../../services/finance/calc');
const {
  resolvePeriod, previousRange, autoGroup, normalizeGroup, pctChange,
  buildCashflowSeries, buildBillingSeries,
} = require('../../services/finance/reporting');

// GET /api/financial/summary/overview — Dashboard Financeiro (agregado)
// Query: preset=today|week|month|30d|quarter|year OU start&end; group=day|week|month.
// Todos os agregados calculados no banco + bucketing no backend (nunca no front).
router.get('/overview', requireFinanceRead, async (req, res) => {
  try {
    const period = resolvePeriod({ preset: req.query.preset, start: req.query.start, end: req.query.end });
    const group = req.query.group ? normalizeGroup(req.query.group) : autoGroup(period.start, period.end);
    const prev = previousRange(period.start, period.end);

    const [
      cashNow, cashPrev,
      billKpisNow, billKpisPrev,
      receivedNow, receivedPrev,
      cashflowRows, billedRows, receivedRows,
      statusDist, byService, byMethod, byCategory,
    ] = await Promise.all([
      txModel.getSummary(req.tenantId, { date_from: period.start, date_to: period.end }),
      txModel.getSummary(req.tenantId, { date_from: prev.start, date_to: prev.end }),
      reportModel.getBillingKpis(req.tenantId, period),
      reportModel.getBillingKpis(req.tenantId, prev),
      reportModel.getReceivedTotal(req.tenantId, period),
      reportModel.getReceivedTotal(req.tenantId, prev),
      reportModel.getCashflowByDate(req.tenantId, period),
      reportModel.getBilledByDate(req.tenantId, period),
      reportModel.getReceivedByDate(req.tenantId, period),
      reportModel.getStatusDistribution(req.tenantId, period),
      reportModel.getRevenueByService(req.tenantId, period),
      reportModel.getPaymentMethodDistribution(req.tenantId, period),
      reportModel.getCategoryBreakdown(req.tenantId, period),
    ]);

    const n = (v) => Number(v) || 0;
    const kpi = (value, previous, direction = 'up') => ({
      value: n(value), previous: n(previous), change: pctChange(value, previous), direction,
    });
    const faturadoNow = n(billKpisNow.faturado);
    const countFatNow = n(billKpisNow.count_faturados);
    const faturadoPrev = n(billKpisPrev.faturado);
    const countFatPrev = n(billKpisPrev.count_faturados);

    res.json({
      success: true,
      data: {
        period: { ...period, group, previous: prev },
        kpis: {
          // direction: 'up' = crescer é bom; 'down' = crescer é ruim; 'neutral' = informativo
          entradas: kpi(cashNow.total_entradas, cashPrev.total_entradas, 'up'),
          saidas: kpi(cashNow.total_saidas, cashPrev.total_saidas, 'down'),
          saldo: kpi(cashNow.saldo, cashPrev.saldo, 'up'),
          faturado: kpi(faturadoNow, faturadoPrev, 'up'),
          recebido: kpi(receivedNow.total, receivedPrev.total, 'up'),
          pendente: kpi(billKpisNow.pendente, billKpisPrev.pendente, 'down'),
          vencido: kpi(billKpisNow.vencido, billKpisPrev.vencido, 'down'),
          ticket_medio: kpi(
            countFatNow ? faturadoNow / countFatNow : 0,
            countFatPrev ? faturadoPrev / countFatPrev : 0, 'up'),
          servicos_faturados: kpi(countFatNow, countFatPrev, 'neutral'),
          servicos_pagos: kpi(billKpisNow.count_pagos, billKpisPrev.count_pagos, 'up'),
        },
        charts: {
          cashflow: buildCashflowSeries(cashflowRows, period.start, period.end, group),
          billing: buildBillingSeries(billedRows, receivedRows, period.start, period.end, group),
          status: statusDist.map((r) => ({ status: r.status, count: r.count, total: n(r.total) })),
          services: byService.map((r) => ({ service: r.service, total: n(r.total), count: r.count })),
          methods: byMethod.map((r) => ({ method: r.method, total: n(r.total), count: r.count })),
          categories: byCategory.map((r) => ({ category: r.category, type: r.type, total: n(r.total) })),
        },
      },
    });
  } catch (err) {
    console.error('[finance] overview:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao carregar o dashboard financeiro' });
  }
});

// GET /api/financial/summary/dashboard — indicadores financeiros do dashboard
router.get('/dashboard', requireFinanceRead, async (req, res) => {
  try {
    const week = getWeekRange(new Date(), 1);
    const month = getMonthRange(new Date());

    const [weekCash, monthCash, billing] = await Promise.all([
      txModel.getSummary(req.tenantId, { date_from: week.start, date_to: week.end }),
      txModel.getSummary(req.tenantId, { date_from: month.start, date_to: month.end }),
      billingModel.getBillingDashboard(req.tenantId, { monthStart: month.start, monthEnd: month.end }),
    ]);

    res.json({
      success: true,
      data: {
        week: {
          range: week,
          entradas: Number(weekCash.total_entradas),
          saidas: Number(weekCash.total_saidas),
          saldo: Number(weekCash.saldo),
        },
        month: {
          range: month,
          faturamento: Number(billing.faturamento_mes),
          recebidos: Number(monthCash.recebidos),
          pendentes: Number(billing.total_pendente),
          vencidos: Number(billing.total_vencido),
        },
        services: {
          pagos: billing.servicos_pagos,
          pendentes: billing.servicos_pendentes,
        },
      },
    });
  } catch (err) {
    console.error('[finance] dashboard:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao carregar indicadores financeiros' });
  }
});

// GET /api/financial/summary/client/:clientId — histórico financeiro do cliente
router.get('/client/:clientId', requireFinanceRead, async (req, res) => {
  try {
    const { clientId } = req.params;
    const [summary, billings, payments, receipts, transactions] = await Promise.all([
      billingModel.getClientSummary(clientId, req.tenantId),
      billingModel.getBillingsByClient(clientId, req.tenantId),
      paymentModel.getPaymentsByClient(clientId, req.tenantId),
      receiptModel.getReceiptsByClient(clientId, req.tenantId),
      txModel.getTransactionsByClient(clientId, req.tenantId),
    ]);
    res.json({ success: true, data: { summary, billings, payments, receipts, transactions } });
  } catch (err) {
    console.error('[finance] histórico do cliente:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao carregar histórico financeiro do cliente' });
  }
});

// GET /api/financial/summary/fine/:fineId — histórico financeiro do processo (multa)
router.get('/fine/:fineId', requireFinanceRead, async (req, res) => {
  try {
    const { fineId } = req.params;
    const [summary, billings, payments, receipts, transactions] = await Promise.all([
      billingModel.getFineSummary(fineId, req.tenantId),
      billingModel.getBillingsByFine(fineId, req.tenantId),
      paymentModel.getPaymentsByFine(fineId, req.tenantId),
      receiptModel.getReceiptsByFine(fineId, req.tenantId),
      txModel.getTransactionsByFine(fineId, req.tenantId),
    ]);
    res.json({ success: true, data: { summary, billings, payments, receipts, transactions } });
  } catch (err) {
    console.error('[finance] histórico do processo:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao carregar histórico financeiro do processo' });
  }
});

module.exports = router;
