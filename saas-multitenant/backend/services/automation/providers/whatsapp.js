'use strict';

const crypto = require('node:crypto');
const { getSecret } = require('../secrets');
const { verifyHmacSignature, safeEqual } = require('../webhookSecurity');
const { assertSandboxAllowed, sandboxSignatureResult } = require('./guard');

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

const sandboxProvider = {
  name: 'null',
  isSandbox: true,
  async sendTemplateMessage({ to }) {
    assertSandboxAllowed('WhatsApp');
    return { external_id: `sandbox-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'sent', to };
  },
  async getMessageStatus() { return { status: 'delivered' }; },
  verifyWebhookSignature() { return sandboxSignatureResult(); },
  parseWebhook(body = {}) {
    const event = body.event_id || body.message_id || body.external_id || `wa-evt-${Date.now()}`;
    return { external_event_id: String(event), updates: [{ external_id: body.external_id || body.message_id || null, status: body.status || 'delivered' }] };
  },
  estimateMessageCost(settings) { return Number(settings?.cost_per_message || 0); },
  async testConnection() { assertSandboxAllowed('Teste WhatsApp'); return { ok: true, mode: 'sandbox' }; },
};

function metaProvider({ fetchImpl, secretFn = getSecret, settings = {} } = {}) {
  const doFetch = fetchImpl || global.fetch;
  const cfg = settings.whatsapp_config || {};
  const version = cfg.graph_api_version || secretFn('META_GRAPH', 'API_VERSION') || process.env.META_GRAPH_API_VERSION || 'v20.0';
  const creds = () => ({
    token: secretFn('META_WHATSAPP', 'ACCESS_TOKEN'),
    phoneId: cfg.phone_number_id || settings.whatsapp_from || secretFn('META_WHATSAPP', 'PHONE_NUMBER_ID'),
    appSecret: secretFn('META', 'APP_SECRET'),
  });

  const graph = async (path, opts = {}) => {
    const { token } = creds();
    if (!token) throw new Error('WhatsApp Meta sem token de acesso.');
    if (!doFetch) throw new Error('fetch indisponivel no runtime.');
    const res = await doFetch(`https://graph.facebook.com/${version}/${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data?.error || {};
      const e = new Error(err.message || `Meta API ${res.status}`);
      e.code = err.code || `HTTP_${res.status}`;
      throw e;
    }
    return data;
  };

  return {
    name: 'meta',
    isSandbox: false,
    async sendTemplateMessage({ to, provider_template_id, language = 'pt_BR', variables = {} }) {
      const { phoneId } = creds();
      if (!phoneId) throw new Error('Phone Number ID da Meta ausente.');
      if (!provider_template_id) throw new Error('Template aprovado da Meta ausente.');
      const params = Object.values(variables || {}).map((value) => ({ type: 'text', text: String(value) }));
      const data = await graph(`${phoneId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: onlyDigits(to), type: 'template',
          template: {
            name: provider_template_id,
            language: { code: language },
            components: params.length ? [{ type: 'body', parameters: params }] : [],
          },
        }),
      });
      return { external_id: data.messages?.[0]?.id, status: 'sent', to };
    },
    async getMessageStatus() { return { status: 'unknown' }; },
    verifyWebhookSignature(raw, headers = {}) {
      const signature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
      return { valid: verifyHmacSignature(raw, signature, creds().appSecret) };
    },
    parseWebhook(body = {}) {
      const updates = [];
      let eventId = body.entry?.[0]?.id;
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          for (const status of change.value?.statuses || []) {
            updates.push({ external_id: status.id, status: status.status });
            eventId = eventId || status.id;
          }
        }
      }
      return { external_event_id: String(eventId || crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')), updates };
    },
    estimateMessageCost(s) { return Number(s?.cost_per_message || 0); },
    async testConnection() {
      const { phoneId } = creds();
      if (!phoneId) return { ok: false, error: 'Phone Number ID ausente' };
      const data = await graph(`${phoneId}?fields=display_phone_number,verified_name`);
      return { ok: true, number: data.display_phone_number || null, verified_name: data.verified_name || null };
    },
  };
}

function evolutionProvider({ fetchImpl, secretFn = getSecret, settings = {} } = {}) {
  const doFetch = fetchImpl || global.fetch;
  const cfg = settings.whatsapp_config || {};
  const base = String(cfg.api_url || secretFn('EVOLUTION', 'BASE_URL') || '').replace(/\/$/, '');
  const instance = cfg.instance || secretFn('EVOLUTION', 'INSTANCE');
  const apiKey = () => secretFn('EVOLUTION', 'API_KEY');
  const appSecret = () => secretFn('EVOLUTION', 'APP_SECRET');
  const verifyToken = () => secretFn('EVOLUTION', 'VERIFY_TOKEN');

  const call = async (method, path, body) => {
    if (!base || !instance) throw new Error('Evolution API URL/instancia nao configuradas.');
    if (!apiKey()) throw new Error('Evolution API key nao configurada.');
    if (!doFetch) throw new Error('fetch indisponivel no runtime.');
    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: { apikey: apiKey(), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const e = new Error(`Evolution indisponivel: ${err.message}`); e.retryable = true; throw e;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error(data.message || data.error || `Evolution HTTP ${response.status}`);
      e.code = `HTTP_${response.status}`; e.retryable = response.status >= 500 || response.status === 429; throw e;
    }
    return data;
  };

  return {
    name: 'evolution',
    isSandbox: false,
    providerMode: cfg.provider_mode || 'cloud',
    async sendTemplateMessage({ to, provider_template_id, language = 'pt_BR', variables = {}, body }) {
      const mode = String(cfg.provider_mode || 'cloud').toLowerCase();
      if (!provider_template_id && mode === 'cloud') {
        throw new Error('Template aprovado do WhatsApp ausente.');
      }
      const parameters = Object.values(variables || {}).map((value) => ({ type: 'text', text: String(value) }));
      let data;
      if (mode === 'cloud') {
        data = await call('POST', `/message/sendTemplate/${encodeURIComponent(instance)}`, {
          number: onlyDigits(to),
          name: provider_template_id,
          language,
          components: parameters.length ? [{ type: 'body', parameters }] : [],
        });
      } else {
        if (cfg.unofficial_acknowledged !== true) {
          throw new Error('O modo WhatsApp Web da Evolution exige reconhecimento explícito dos riscos.');
        }
        // Baileys somente quando o administrador optou explicitamente pelo modo
        // não oficial. Mesmo que exista um template cadastrado, envia o corpo
        // renderizado para não chamar por engano a rota Cloud da Evolution.
        data = await call('POST', `/message/sendText/${encodeURIComponent(instance)}`, {
          number: onlyDigits(to), text: body,
        });
      }
      return {
        external_id: data.key?.id || data.messageId || data.id || null,
        status: 'sent', to,
      };
    },
    async getMessageStatus() { return { status: 'unknown' }; },
    verifyWebhookSignature(raw, headers = {}) {
      const hmac = headers['x-evolution-webhook-signature'];
      if (hmac && appSecret()) return { valid: verifyHmacSignature(raw, hmac, appSecret()) };
      const provided = headers['x-evolution-webhook-secret'] || headers['x-webhook-secret'];
      if (provided && verifyToken()) return { valid: safeEqual(provided, verifyToken()) };
      return { valid: false };
    },
    parseWebhook(body = {}) {
      const data = body.data || body;
      const messageId = data.key?.id || data.messageId || data.id || null;
      const rawStatus = data.status || data.update?.status || body.status || body.event;
      const map = {
        SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered', READ: 'read',
        MESSAGES_UPSERT: 'sent', MESSAGES_UPDATE: 'delivered',
      };
      const status = map[String(rawStatus || '').toUpperCase()] || String(rawStatus || 'delivered').toLowerCase();
      const eventId = body.event_id || `${messageId || 'evolution'}:${status}`;
      return { external_event_id: String(eventId), updates: messageId ? [{ external_id: messageId, status }] : [] };
    },
    estimateMessageCost(s) { return Number(s?.cost_per_message || 0); },
    async testConnection() {
      const data = await call('GET', `/instance/connectionState/${encodeURIComponent(instance)}`);
      const state = data.instance?.state || data.state || data.status || 'unknown';
      return { ok: ['open', 'connected'].includes(String(state).toLowerCase()), state };
    },
  };
}

function getWhatsAppProvider(settings = {}, deps = {}) {
  const provider = String(settings.whatsapp_provider || 'null').toLowerCase();
  if (!provider || provider === 'null') return sandboxProvider;
  if (provider === 'meta') return metaProvider({ ...deps, settings });
  if (provider === 'evolution') return evolutionProvider({ ...deps, settings });
  return {
    name: provider, isSandbox: false,
    async sendTemplateMessage() { throw new Error(`Provedor WhatsApp "${provider}" nao implementado.`); },
    verifyWebhookSignature() { return { valid: false }; },
    parseWebhook() { return { external_event_id: null, updates: [] }; },
    estimateMessageCost(s) { return Number(s?.cost_per_message || 0); },
    async testConnection() { return { ok: false, error: 'Provedor nao implementado' }; },
  };
}

module.exports = {
  getWhatsAppProvider, sandboxProvider, metaProvider, evolutionProvider,
};
