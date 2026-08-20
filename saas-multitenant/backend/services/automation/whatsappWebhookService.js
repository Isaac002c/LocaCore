'use strict';

const crypto = require('node:crypto');
const M = require('../../models/automationModels');
const tenantModel = require('../../models/tenantModels');
const secretStore = require('./secretStore');
const audit = require('./auditService');
const { getWhatsAppProvider } = require('./providers/whatsapp');

const STATUS_MAP = { delivered: 'delivered', read: 'read', failed: 'failed', sent: 'sent' };

async function handleWebhook(providerName, body, {
  rawBody = Buffer.from(JSON.stringify(body || {})), headers = {},
} = {}) {
  const name = String(providerName || '').toLowerCase();
  const parser = getWhatsAppProvider({ whatsapp_provider: name });
  const parsed = parser.parseWebhook(body);
  const candidates = [];
  for (const update of parsed.updates || []) {
    if (!update.external_id) continue;
    const message = await M.getOutboxByExternal(parser.name, update.external_id);
    if (message) candidates.push({ update, message });
  }
  // Sem uma mensagem nossa nao existe forma segura de resolver o tenant.
  if (!candidates.length) return { ok: true, ignored: true, reason: 'message_not_found' };
  const tenantIds = [...new Set(candidates.map((x) => x.message.tenant_id))];
  if (tenantIds.length !== 1) {
    const err = new Error('Webhook com mensagens de tenants diferentes.'); err.statusCode = 401; throw err;
  }
  const tenant_id = tenantIds[0];
  const settings = await M.getSettings(tenant_id) || {};
  if (String(settings.whatsapp_provider || '').toLowerCase() !== parser.name) {
    const err = new Error('Provider do webhook nao corresponde ao tenant.'); err.statusCode = 401; throw err;
  }
  const [stored, tenant] = await Promise.all([
    secretStore.getSecrets(tenant_id, `whatsapp:${parser.name}`),
    tenantModel.getTenantById(tenant_id).catch(() => null),
  ]);
  const provider = getWhatsAppProvider(settings, { secretFn: secretStore.resolver(stored, tenant?.slug) });
  if (!provider.verifyWebhookSignature(rawBody, headers).valid) {
    await audit.record({ tenant_id, event_type: 'whatsapp_webhook_rejected', status: 'rejected',
      provider: provider.name, error_code: 'INVALID_SIGNATURE' });
    const err = new Error('Assinatura do webhook invalida.'); err.statusCode = 401; throw err;
  }

  const eventId = parsed.external_event_id || crypto.createHash('sha256').update(rawBody).digest('hex');
  const isNew = await M.registerWebhookEvent({
    tenant_id, provider: provider.name, kind: 'whatsapp', external_event_id: eventId,
    payload_hash: crypto.createHash('sha256').update(rawBody).digest('hex'),
  });
  if (!isNew) return { ok: true, duplicate: true };

  let updated = 0;
  try {
    for (const { update, message } of candidates) {
      const status = STATUS_MAP[update.status] || null;
      if (!status) continue;
      const fields = { status };
      if (status === 'delivered') fields.delivered_at = new Date().toISOString();
      if (status === 'read') {
        fields.read_at = new Date().toISOString();
        if (!message.delivered_at) fields.delivered_at = new Date().toISOString();
      }
      if (status === 'failed') fields.error = 'Falha reportada pelo provedor';
      await M.updateOutbox(message.id, tenant_id, fields);
      updated++;
    }
    await M.markWebhookProcessed(provider.name, eventId);
    await audit.record({ tenant_id, event_type: 'whatsapp_webhook_processed', status: 'processed',
      provider: provider.name, request_id: eventId, details: { updated } });
    return { ok: true, updated };
  } catch (err) {
    await M.markWebhookProcessed(provider.name, eventId, { status: 'failed', error_message: err.message }).catch(() => {});
    throw err;
  }
}

module.exports = { handleWebhook };
