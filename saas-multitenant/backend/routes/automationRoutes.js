const express = require('express');
const router = express.Router();
const M = require('../models/automationModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const billingCycle = require('../services/automation/billingCycleService');
const dunning = require('../services/automation/dunningService');
const outbox = require('../services/automation/outboxService');
const fiscalService = require('../services/automation/fiscalService');
const { validateConfig } = require('../services/automation/providers/fiscal');
const activityLog = require('../services/activityLogService');

// Automação exige o módulo "locacao" habilitado + tenantContext (global).
router.use(requireModule('locacao'));

const wrap = (res, err, ctx) => { console.error(ctx, err.message); res.status(500).json({ success: false, error: 'Erro interno' }); };

// ── Configurações ────────────────────────────────────────────────────────────
router.get('/settings', checkPermission('automations:read'), async (req, res) => {
  try {
    const settings = await M.ensureSettings(req.tenantId);
    await M.ensureDefaultTemplates(req.tenantId);
    res.json({ success: true, data: { settings, fiscal_validation: validateConfig(settings) } });
  } catch (err) { wrap(res, err, 'automations/settings:'); }
});

router.put('/settings', checkPermission('automations:manage'), async (req, res) => {
  try {
    const settings = await M.updateSettings(req.tenantId, req.body || {});
    activityLog.logGeneric(req.tenantId, req.userId, 'update', 'automation_settings', 'Configurações de automação atualizadas', {}).catch(() => {});
    res.json({ success: true, data: { settings, fiscal_validation: validateConfig(settings) } });
  } catch (err) { wrap(res, err, 'automations/settings PUT:'); }
});

// ── Templates ────────────────────────────────────────────────────────────────
router.get('/templates', checkPermission('automations:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.listTemplates(req.tenantId) }); }
  catch (err) { wrap(res, err, 'automations/templates:'); }
});
router.put('/templates', checkPermission('automations:manage'), async (req, res) => {
  try {
    if (!req.body.kind || !req.body.body) return res.status(400).json({ success: false, error: 'kind e body são obrigatórios' });
    res.json({ success: true, data: await M.upsertTemplate(req.tenantId, req.body) });
  } catch (err) { wrap(res, err, 'automations/templates PUT:'); }
});

// ── Painel / execuções ───────────────────────────────────────────────────────
router.get('/runs', checkPermission('automations:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.listRuns(req.tenantId, { limit: req.query.limit }) }); }
  catch (err) { wrap(res, err, 'automations/runs:'); }
});

router.get('/status', checkPermission('automations:read'), async (req, res) => {
  try {
    const [settings, runs, pending, sent, failed, cost] = await Promise.all([
      M.ensureSettings(req.tenantId),
      M.listRuns(req.tenantId, { limit: 5 }),
      M.listOutbox(req.tenantId, { status: 'pending', limit: 500 }),
      M.listOutbox(req.tenantId, { status: 'sent', limit: 500 }),
      M.listOutbox(req.tenantId, { status: 'failed', limit: 500 }),
      M.costReport(req.tenantId, {}),
    ]);
    res.json({ success: true, data: {
      settings, last_runs: runs,
      messages: { pending: pending.length, sent: sent.length, failed: failed.length },
      cost,
    } });
  } catch (err) { wrap(res, err, 'automations/status:'); }
});

// ── Disparos manuais (respeitam idempotência) ────────────────────────────────
router.post('/run/billing', checkPermission('automations:manage'), async (req, res) => {
  try { res.json({ success: true, data: await billingCycle.runBilling(req.tenantId, { force: true }) }); }
  catch (err) { wrap(res, err, 'automations/run/billing:'); }
});
router.post('/run/dunning', checkPermission('automations:manage'), async (req, res) => {
  try { res.json({ success: true, data: await dunning.runDunning(req.tenantId, {}) }); }
  catch (err) { wrap(res, err, 'automations/run/dunning:'); }
});
router.post('/run/outbox', checkPermission('whatsapp:send'), async (req, res) => {
  try { res.json({ success: true, data: await outbox.process(req.tenantId, { limit: 50 }) }); }
  catch (err) { wrap(res, err, 'automations/run/outbox:'); }
});
router.post('/run/fiscal-batch', checkPermission('fiscal:issue'), async (req, res) => {
  try { res.json({ success: true, data: await fiscalService.runBatch(req.tenantId, {}) }); }
  catch (err) { wrap(res, err, 'automations/run/fiscal-batch:'); }
});

// ── Mensagens (outbox) ───────────────────────────────────────────────────────
router.get('/messages', checkPermission('whatsapp:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.listOutbox(req.tenantId, { status: req.query.status, kind: req.query.kind, limit: req.query.limit }) }); }
  catch (err) { wrap(res, err, 'automations/messages:'); }
});
router.post('/messages/:id/retry', checkPermission('whatsapp:retry'), async (req, res) => {
  try {
    const row = await outbox.retry(req.tenantId, req.params.id);
    if (!row) return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    res.json({ success: true, data: row });
  } catch (err) { wrap(res, err, 'automations/messages/retry:'); }
});

// ── Notas fiscais ────────────────────────────────────────────────────────────
router.get('/fiscal', checkPermission('fiscal:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.listFiscal(req.tenantId, { status: req.query.status, limit: req.query.limit }) }); }
  catch (err) { wrap(res, err, 'automations/fiscal:'); }
});
router.post('/fiscal/issue', checkPermission('fiscal:issue'), async (req, res) => {
  try {
    if (!req.body.payment_id) return res.status(400).json({ success: false, error: 'payment_id é obrigatório' });
    const doc = await fiscalService.issueForPayment(req.tenantId, req.body.payment_id, { created_by: req.userId });
    res.json({ success: true, data: doc });
  } catch (err) { wrap(res, err, 'automations/fiscal/issue:'); }
});
router.post('/fiscal/:id/retry', checkPermission('fiscal:retry'), async (req, res) => {
  try { res.json({ success: true, data: await fiscalService.retry(req.tenantId, req.params.id) }); }
  catch (err) { wrap(res, err, 'automations/fiscal/retry:'); }
});

// ── Custos externos ──────────────────────────────────────────────────────────
router.get('/costs', checkPermission('external_costs:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.costReport(req.tenantId, { from: req.query.from, to: req.query.to }) }); }
  catch (err) { wrap(res, err, 'automations/costs:'); }
});

module.exports = router;
