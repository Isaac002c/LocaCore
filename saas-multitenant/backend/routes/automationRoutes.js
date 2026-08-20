const express = require('express');
const router = express.Router();
const multer = require('multer');
const M = require('../models/automationModels');
const { checkPermission } = require('../middlewares/checkPermission');
const { requireModule } = require('../middlewares/requireModule');
const billingCycle = require('../services/automation/billingCycleService');
const paymentConfirm = require('../services/automation/paymentConfirmService');
const dunning = require('../services/automation/dunningService');
const outbox = require('../services/automation/outboxService');
const fiscalService = require('../services/automation/fiscalService');
const { validateConfig } = require('../services/automation/providers/fiscal');
const { integrationsReadiness } = require('../services/automation/readiness');
const tenantModel = require('../models/tenantModels');
const activityLog = require('../services/activityLogService');
const secretStore = require('../services/automation/secretStore');
const certificateService = require('../services/automation/fiscalCertificateService');
const audit = require('../services/automation/auditService');
const { getWhatsAppProvider } = require('../services/automation/providers/whatsapp');

const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: certificateService.MAX_CERTIFICATE_SIZE, files: 1 },
});

const PROVIDERS = {
  payment: new Set(['null', 'asaas', 'infinitepay']),
  whatsapp: new Set(['null', 'meta', 'evolution']),
  fiscal: new Set(['null', 'focusnfe', 'nfse_nacional']),
};
const ACTIVE_MODES = new Set(['pilot', 'staged', 'global']);

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
    const patch = req.body || {};
    for (const [field, kind] of [['payment_provider', 'payment'], ['whatsapp_provider', 'whatsapp'], ['fiscal_provider', 'fiscal']]) {
      if (patch[field] !== undefined && !PROVIDERS[kind].has(String(patch[field]).toLowerCase())) {
        return res.status(400).json({ success: false, error: `Provedor ${patch[field]} nao implementado.` });
      }
    }
    if (patch.automation_mode !== undefined && !['off', 'dry_run', 'pilot', 'staged', 'global'].includes(patch.automation_mode)) {
      return res.status(400).json({ success: false, error: 'Modo de automacao invalido.' });
    }
    const current = await M.ensureSettings(req.tenantId);
    const proposed = { ...current, ...patch };
    if (ACTIVE_MODES.has(proposed.automation_mode)) {
      const tenant = await tenantModel.getTenantById(req.tenantId).catch(() => null);
      const readiness = await integrationsReadiness(proposed, tenant?.slug, { tenant_id: req.tenantId, mode: proposed.automation_mode });
      if (!readiness.activation.allowed) {
        return res.status(409).json({ success: false, error: 'Ativacao bloqueada pela prontidao.', data: readiness });
      }
    }
    const settings = await M.updateSettings(req.tenantId, patch);
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
    const rentalIds = typeof req.query.rental_ids === 'string'
      ? req.query.rental_ids.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100)
      : null;
    res.json({ success: true, data: await integrationsReadiness(settings, tenant?.slug, {
      tenant_id: req.tenantId, mode: req.query.mode || settings.automation_mode, rental_ids: rentalIds,
    }) });
  } catch (err) { wrap(res, err, 'automations/integrations:'); }
});

const SECRET_FIELDS = {
  'payment:asaas': new Set(['KEY', 'WEBHOOK_TOKEN']),
  'payment:infinitepay': new Set([]),
  'whatsapp:meta': new Set(['ACCESS_TOKEN', 'APP_SECRET', 'VERIFY_TOKEN']),
  'whatsapp:evolution': new Set(['API_KEY', 'APP_SECRET', 'VERIFY_TOKEN']),
  'fiscal:focusnfe': new Set(['TOKEN']),
  'fiscal:nfse_nacional': new Set(['TOKEN']),
};

async function integrationScope(tenant_id, kind) {
  const settings = await M.ensureSettings(tenant_id);
  const field = kind === 'payment' ? 'payment_provider' : kind === 'whatsapp' ? 'whatsapp_provider' : kind === 'fiscal' ? 'fiscal_provider' : null;
  if (!field) return null;
  const provider = String(settings[field] || 'null').toLowerCase();
  return { settings, provider, scope: `${kind}:${provider}`, allowed: SECRET_FIELDS[`${kind}:${provider}`] || new Set() };
}

router.get('/integrations/:kind/secrets', checkPermission('automations:manage'), async (req, res) => {
  try {
    const cfg = await integrationScope(req.tenantId, req.params.kind);
    if (!cfg) return res.status(400).json({ success: false, error: 'Integracao invalida.' });
    const present = await secretStore.secretPresence(req.tenantId, cfg.scope);
    res.json({ success: true, data: { provider: cfg.provider, encryption_ready: secretStore.encryptionReady(), present } });
  } catch (err) { wrap(res, err, 'automations/integration secrets GET:'); }
});

router.put('/integrations/:kind/secrets', checkPermission('automations:manage'), async (req, res) => {
  try {
    const cfg = await integrationScope(req.tenantId, req.params.kind);
    if (!cfg || !cfg.allowed.size) return res.status(400).json({ success: false, error: 'Este provedor nao recebe secrets por esta tela.' });
    const values = {};
    for (const [rawName, value] of Object.entries(req.body || {})) {
      const name = String(rawName).toUpperCase();
      if (!cfg.allowed.has(name)) return res.status(400).json({ success: false, error: `Campo secreto ${name} nao permitido.` });
      if (typeof value !== 'string' || value.length > 10000) return res.status(400).json({ success: false, error: `Valor invalido para ${name}.` });
      if (value.trim()) values[name] = value;
    }
    const saved = await secretStore.setSecrets(req.tenantId, cfg.scope, values);
    await audit.record({ tenant_id: req.tenantId, event_type: 'integration_secrets_updated', status: 'completed', provider: cfg.provider,
      details: { source: req.params.kind } });
    res.json({ success: true, data: { provider: cfg.provider, saved } });
  } catch (err) {
    if (/AUTOMATION_SECRETS_KEY/.test(err.message)) return res.status(503).json({ success: false, error: err.message });
    wrap(res, err, 'automations/integration secrets PUT:');
  }
});

router.post('/integrations/:kind/test', checkPermission('automations:manage'), async (req, res) => {
  try {
    const cfg = await integrationScope(req.tenantId, req.params.kind);
    if (!cfg) return res.status(400).json({ success: false, error: 'Integracao invalida.' });
    let result;
    if (req.params.kind === 'payment') {
      const provider = await billingCycle.providerForTenant(req.tenantId, cfg.settings);
      result = await provider.testConnection();
    } else if (req.params.kind === 'whatsapp') {
      const [values, tenant] = await Promise.all([
        secretStore.getSecrets(req.tenantId, cfg.scope),
        tenantModel.getTenantById(req.tenantId).catch(() => null),
      ]);
      result = await getWhatsAppProvider(cfg.settings, { secretFn: secretStore.resolver(values, tenant?.slug) }).testConnection();
    } else {
      const provider = await fiscalService.providerForTenant(req.tenantId, cfg.settings);
      const validation = provider.validateConfiguration(cfg.settings);
      result = { ok: validation.ok, missing: validation.missing || [], provider: provider.name };
    }
    await audit.record({ tenant_id: req.tenantId, event_type: 'integration_connection_test',
      status: result.ok ? 'completed' : 'failed', provider: cfg.provider, details: { source: req.params.kind } });
    res.status(result.ok ? 200 : 422).json({ success: !!result.ok, data: result, error: result.ok ? undefined : result.error || 'Integracao incompleta.' });
  } catch (err) {
    res.status(422).json({ success: false, error: String(err.message).slice(0, 300) });
  }
});

router.get('/fiscal/certificate', checkPermission('fiscal:read'), async (req, res) => {
  try { res.json({ success: true, data: await certificateService.getCertificateMetadata(req.tenantId) }); }
  catch (err) { wrap(res, err, 'automations/fiscal/certificate GET:'); }
});
router.post('/fiscal/certificate', checkPermission('fiscal:configure'), certificateUpload.single('certificate'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Certificado A1 ausente.' });
    const metadata = await certificateService.storeCertificate(req.tenantId, {
      buffer: req.file.buffer, filename: req.file.originalname, mime_type: req.file.mimetype,
      password: req.body?.password,
    });
    await audit.record({ tenant_id: req.tenantId, event_type: 'fiscal_certificate_updated', status: 'completed' });
    res.json({ success: true, data: metadata });
  } catch (err) {
    const status = err.code === 'INVALID_CERTIFICATE' ? 400 : /AUTOMATION_SECRETS_KEY/.test(err.message) ? 503 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/dry-run', checkPermission('automations:manage'), async (req, res) => {
  try {
    const rentalIds = Array.isArray(req.body?.rental_ids) ? req.body.rental_ids : null;
    res.json({ success: true, data: await billingCycle.dryRun(req.tenantId, { rental_ids: rentalIds }) });
  } catch (err) { wrap(res, err, 'automations/dry-run:'); }
});

router.get('/charges', checkPermission('automations:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.listCharges(req.tenantId, req.query || {}) }); }
  catch (err) { wrap(res, err, 'automations/charges:'); }
});
router.post('/charges/:id/retry', checkPermission('automations:manage'), async (req, res) => {
  try {
    const row = await billingCycle.retryCharge(req.tenantId, req.params.id, { request_id: req.headers['x-request-id'] || null });
    if (!row) return res.status(404).json({ success: false, error: 'Cobranca nao encontrada.' });
    res.json({ success: true, data: row });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ success: false, error: err.message });
    wrap(res, err, 'automations/charges retry:');
  }
});

// POST /charges/:id/confirm — confirmação manual do pagamento (§49). Aciona o
// MESMO pipeline pós-pagamento (recibo/NFS-e → documento → WhatsApp).
router.post('/charges/:id/confirm', checkPermission('automations:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const result = await paymentConfirm.confirmManual(req.tenantId, req.params.id, {
      amount: b.amount, payment_date: b.payment_date, payment_method: b.payment_method || 'pix',
      notes: b.notes, created_by: req.userId, created_by_name: req.userName || null,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
    wrap(res, err, 'automations/charges confirm:');
  }
});

// GET /charges/:id/timeline — linha do tempo da cobrança (§38), da trilha de auditoria.
router.get('/charges/:id/timeline', checkPermission('automations:read'), async (req, res) => {
  try {
    const events = await audit.list(req.tenantId, { charge_id: req.params.id, limit: 100 });
    res.json({ success: true, data: events });
  } catch (err) { wrap(res, err, 'automations/charges timeline:'); }
});

router.get('/audit', checkPermission('automations:read'), async (req, res) => {
  try { res.json({ success: true, data: await audit.list(req.tenantId, { limit: req.query.limit, charge_id: req.query.charge_id }) }); }
  catch (err) { wrap(res, err, 'automations/audit:'); }
});

router.get('/fiscal/categories', checkPermission('fiscal:read'), async (req, res) => {
  try { res.json({ success: true, data: await M.ensureDefaultFiscalCategories(req.tenantId) }); }
  catch (err) { wrap(res, err, 'automations/fiscal/categories:'); }
});
router.put('/fiscal/categories/:key', checkPermission('fiscal:configure'), async (req, res) => {
  try {
    const allowedKeys = new Set(['locacao', 'multa', 'juros', 'caucao', 'manutencao', 'avaria', 'combustivel', 'servico_adicional']);
    if (!allowedKeys.has(req.params.key)) return res.status(400).json({ success: false, error: 'Categoria fiscal invalida.' });
    const row = await M.upsertFiscalCategoryMapping(req.tenantId, { ...req.body, category_key: req.params.key, label: req.body?.label || req.params.key });
    res.json({ success: true, data: row });
  } catch (err) { wrap(res, err, 'automations/fiscal/categories PUT:'); }
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
