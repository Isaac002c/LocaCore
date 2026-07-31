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
const { integrationsReadiness } = require('../services/automation/readiness');
const tenantModel = require('../models/tenantModels');
const activityLog = require('../services/activityLogService');

// Automação exige o módulo "locacao" habilitado + tenantContext (global).
router.use(requireModule('locacao'));

const wrap = (res, err, ctx) => { console.error(ctx, err.message); res.status(500).json({ success: false, error: 'Erro interno' }); };

// Remove qualquer campo sensível antes de devolver uma mensagem da fila (§8):
// nada de token, assinatura, corpo bruto do provedor ou telefone completo.
const mascararTelefone = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 6) return t || null;
  return `${d.slice(0, 4)}****${d.slice(-2)}`;
};
const sanitizarMensagem = (m = {}) => ({
  id: m.id,
  template_kind: m.template_kind,
  to_number: mascararTelefone(m.to_number),
  status: m.status,
  attempts: m.attempts,
  max_attempts: m.max_attempts,
  provider: m.provider,
  error: m.error ? String(m.error).slice(0, 300) : null,
  created_at: m.created_at,
  updated_at: m.updated_at,
  next_attempt_at: m.next_attempt_at,
  charge_id: m.charge_id || null,
  rental_id: m.rental_id || null,
  client_id: m.client_id || null,
});

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

// ── Prontidão das integrações (§13) ─────────────────────────────────────────
// Diz o que já existe e o que falta para ligar cada integração em produção.
// NUNCA devolve o valor de um secret — apenas se ele está presente.
router.get('/integrations', checkPermission('automations:read'), async (req, res) => {
  try {
    const [settings, tenant] = await Promise.all([
      M.ensureSettings(req.tenantId),
      tenantModel.getTenantById(req.tenantId).catch(() => null),
    ]);
    res.json({ success: true, data: integrationsReadiness(settings, tenant?.slug) });
  } catch (err) { wrap(res, err, 'automations/integrations:'); }
});

// ── CONSOLE OPERACIONAL (§8) ────────────────────────────────────────────────
// Uma chamada com tudo que o operador precisa ver: worker, scheduler, jobs,
// fila (pendente/processando/concluído/falha/dead-letter/retries), cobranças,
// pagamentos conciliados, fiscais e custos do período.
router.get('/console', checkPermission('automations:read'), async (req, res) => {
  try {
    const [settings, runs, fila, contadores, heartbeats, custos] = await Promise.all([
      M.ensureSettings(req.tenantId),
      M.listRuns(req.tenantId, { limit: 20 }),
      M.outboxCounters(req.tenantId),
      M.consoleCounters(req.tenantId),
      M.serviceHeartbeats(),
      M.costReport(req.tenantId, { from: req.query.from, to: req.query.to }),
    ]);

    // Jobs do scheduler: nome + intervalo declarado (env-overridable).
    const min = (m) => m * 60 * 1000;
    const intervalo = (envVar, padrao) => parseInt(process.env[envVar], 10) || padrao;
    const jobs = [
      { name: 'overdue', label: 'Marcar locações atrasadas', every_ms: intervalo('SCHED_OVERDUE_MS', min(60)) },
      { name: 'outbox',  label: 'Processar fila de mensagens', every_ms: intervalo('SCHED_OUTBOX_MS', min(5)) },
      { name: 'dunning', label: 'Régua de inadimplência',      every_ms: intervalo('SCHED_DUNNING_MS', min(360)) },
      { name: 'billing', label: 'Cobrança semanal',            every_ms: intervalo('SCHED_BILLING_MS', min(60)) },
      { name: 'fiscal',  label: 'Emissão fiscal em lote',      every_ms: intervalo('SCHED_FISCAL_MS', min(720)) },
    ];

    // Última execução por job + estimativa da próxima (último início + intervalo).
    const ultimaPorJob = {};
    for (const r of runs) {
      if (!ultimaPorJob[r.run_type] || new Date(r.started_at) > new Date(ultimaPorJob[r.run_type].started_at)) {
        ultimaPorJob[r.run_type] = r;
      }
    }
    const jobsComExecucao = jobs.map((j) => {
      const ultima = ultimaPorJob[j.name] || null;
      const proxima = ultima?.started_at
        ? new Date(new Date(ultima.started_at).getTime() + j.every_ms).toISOString()
        : null;
      return {
        ...j,
        ultima_execucao: ultima?.started_at || null,
        ultimo_status: ultima?.status || null,
        proxima_execucao: proxima,
      };
    });

    res.json({
      success: true,
      data: {
        servicos: {
          worker: heartbeats.worker || { ativo: false, last_beat: null, age_seconds: null },
          scheduler: heartbeats.scheduler || { ativo: false, last_beat: null, age_seconds: null },
        },
        jobs: jobsComExecucao,
        fila,
        contadores,
        custos,
        ultimas_execucoes: runs,
        settings,
        fiscal_validation: validateConfig(settings),
      },
    });
  } catch (err) { wrap(res, err, 'automations/console:'); }
});

// GET /api/automations/dead-letter — mensagens que esgotaram as tentativas.
// Payload SANITIZADO: sem token, assinatura ou corpo bruto do provedor.
router.get('/dead-letter', checkPermission('whatsapp:read'), async (req, res) => {
  try {
    const rows = await M.listDeadLetter(req.tenantId, { limit: req.query.limit });
    res.json({ success: true, data: rows.map(sanitizarMensagem) });
  } catch (err) { wrap(res, err, 'automations/dead-letter:'); }
});

// POST /api/automations/dead-letter/:id/cancel — encerra sem reprocessar
// (a operação assume o contato manualmente).
router.post('/dead-letter/:id/cancel', checkPermission('whatsapp:retry'), async (req, res) => {
  try {
    const m = await M.updateOutbox(req.params.id, req.tenantId, {
      status: 'canceled',
      error: String(req.body?.reason || 'Cancelada pelo operador').slice(0, 500),
    });
    if (!m) return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    activityLog.logGeneric(req.tenantId, req.userId, 'update', 'message_outbox',
      'Mensagem em dead-letter cancelada', { id: req.params.id }).catch(() => {});
    res.json({ success: true, data: sanitizarMensagem(m) });
  } catch (err) { wrap(res, err, 'automations/dead-letter cancel:'); }
});

// POST /api/automations/dead-letter/:id/manual — marca como atendimento manual.
router.post('/dead-letter/:id/manual', checkPermission('whatsapp:retry'), async (req, res) => {
  try {
    const m = await M.updateOutbox(req.params.id, req.tenantId, {
      status: 'manual',
      error: String(req.body?.reason || 'Encaminhada para atendimento manual').slice(0, 500),
    });
    if (!m) return res.status(404).json({ success: false, error: 'Mensagem não encontrada' });
    activityLog.logGeneric(req.tenantId, req.userId, 'update', 'message_outbox',
      'Mensagem encaminhada para atendimento manual', { id: req.params.id }).catch(() => {});
    res.json({ success: true, data: sanitizarMensagem(m) });
  } catch (err) { wrap(res, err, 'automations/dead-letter manual:'); }
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
