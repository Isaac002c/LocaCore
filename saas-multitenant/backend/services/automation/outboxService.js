// =============================================================================
// outboxService.js — Fila de mensagens (WhatsApp). Enfileira e processa com
// retry/backoff, janela de envio, dead-letter e registro de custo. NUNCA envia
// dentro do HTTP/job — sempre via processamento assíncrono da fila.
// =============================================================================

const M = require('../../models/automationModels');
const { getWhatsAppProvider } = require('./providers/whatsapp');

// Backoff progressivo (minutos): 1, 2, 4, 8, ... limitado a 60.
const backoffMinutes = (attempts) => Math.min(60, 2 ** Math.max(0, attempts - 1));

const enqueue = (tenant_id, msg, db) => M.insertOutbox({ tenant_id, ...msg }, db);

// Processa a fila do tenant. Retorna contadores. `now` injetável para testes.
async function process(tenant_id, { limit = 25, now = new Date() } = {}) {
  const settings = await M.getSettings(tenant_id) || {};
  const provider = getWhatsAppProvider(settings);
  const startH = Number(settings.whatsapp_send_start_hour ?? 0);
  const endH = Number(settings.whatsapp_send_end_hour ?? 24);
  const hour = now.getHours();
  const inWindow = hour >= startH && hour < endH;

  const rows = await M.claimPendingOutbox(tenant_id, limit);
  const res = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  for (const m of rows) {
    res.processed++;
    if (settings.whatsapp_enabled === false) {
      await M.updateOutbox(m.id, tenant_id, { status: 'skipped', error: 'WhatsApp desabilitado' });
      res.skipped++; continue;
    }
    if (!inWindow) { res.skipped++; continue; }          // fora da janela: fica pendente p/ próximo tick
    if (!m.to_number) {
      await M.updateOutbox(m.id, tenant_id, { status: 'failed', attempts: m.max_attempts, error: 'Telefone ausente' });
      res.failed++; continue;
    }
    await M.updateOutbox(m.id, tenant_id, { status: 'processing' });
    try {
      // Provedores reais exigem template aprovado (provider_template_id) + variáveis;
      // o sandbox usa o corpo renderizado.
      let tplExtra = {};
      if (!provider.isSandbox) {
        const tpl = await M.getActiveTemplate(tenant_id, m.template_kind);
        tplExtra = { provider_template_id: tpl && tpl.provider_template_id, language: tpl && tpl.language, variables: m.payload };
      }
      const r = await provider.sendTemplateMessage({ to: m.to_number, body: m.body, template_kind: m.template_kind, payload: m.payload, ...tplExtra });
      const cost = Number(settings.cost_per_message || 0);
      await M.updateOutbox(m.id, tenant_id, {
        status: r.status || 'sent', provider: provider.name, external_id: r.external_id || null,
        sent_at: now.toISOString(), cost_amount: cost, error: null,
      });
      if (cost > 0) await M.recordCost({ tenant_id, kind: 'whatsapp_message', ref_id: m.id, provider: provider.name, unit_cost: cost });
      res.sent++;
    } catch (err) {
      const attempts = (m.attempts || 0) + 1;
      const dead = attempts >= (m.max_attempts || 5);
      const next = dead ? null : new Date(now.getTime() + backoffMinutes(attempts) * 60000).toISOString();
      await M.updateOutbox(m.id, tenant_id, { status: 'failed', attempts, next_attempt_at: next, error: String(err.message).slice(0, 500) });
      res.failed++;
    }
  }
  return res;
}

// Reprocessamento manual: zera o agendamento de uma mensagem falha.
async function retry(tenant_id, id) {
  return M.updateOutbox(id, tenant_id, { status: 'pending', next_attempt_at: new Date().toISOString(), error: null });
}

module.exports = { enqueue, process, retry, backoffMinutes };
