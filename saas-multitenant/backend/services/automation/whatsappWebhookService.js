// =============================================================================
// whatsappWebhookService.js — Recebe eventos de status do WhatsApp (entregue,
// lido, falha) e atualiza a mensagem correspondente na outbox. Idempotente por
// evento; tenant resolvido pela própria mensagem (não pelo payload).
// =============================================================================

const M = require('../../models/automationModels');
const { getWhatsAppProvider } = require('./providers/whatsapp');

const STATUS_MAP = { delivered: 'delivered', read: 'read', failed: 'failed', sent: 'sent' };

// A assinatura já foi validada na ROTA (corpo bruto). Aqui recebe o body parseado.
async function handleWebhook(providerName, body) {
  const provider = getWhatsAppProvider({ whatsapp_provider: providerName || 'null' });
  const parsed = provider.parseWebhook(body);
  const isNew = await M.registerWebhookEvent({ provider: provider.name, kind: 'whatsapp', external_event_id: parsed.external_event_id });
  if (!isNew) return { ok: true, duplicate: true };

  let updated = 0;
  for (const u of (parsed.updates || [])) {
    if (!u.external_id) continue;
    const msg = await M.getOutboxByExternal(provider.name, u.external_id);
    if (!msg) continue;
    const status = STATUS_MAP[u.status] || null;
    if (!status) continue;
    const fields = { status };
    if (status === 'delivered') fields.delivered_at = new Date().toISOString();
    if (status === 'read') { fields.read_at = new Date().toISOString(); if (!msg.delivered_at) fields.delivered_at = new Date().toISOString(); }
    if (status === 'failed') fields.error = 'Falha reportada pelo provedor';
    await M.updateOutbox(msg.id, msg.tenant_id, fields);
    updated++;
  }
  return { ok: true, updated };
}

module.exports = { handleWebhook };
