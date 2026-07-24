// =============================================================================
// providers/whatsapp.js — WhatsAppProvider (desacoplado).
//
// Interface: sendTemplateMessage, getMessageStatus, verifyWebhookSignature(raw,headers),
//            parseWebhook(parsedBody), estimateMessageCost.
//
// 'null' = SANDBOX (simula envio; sem chamada externa; sem assinatura).
// 'meta' = Meta WhatsApp Cloud API REAL (Graph API), com credenciais por env:
//   META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID, META_APP_SECRET,
//   META_GRAPH_API_VERSION (default v20.0). Sem credenciais → erro claro.
// NUNCA WhatsApp Web/scraping.
// =============================================================================

const { getSecret } = require('../secrets');
const { verifyHmacSignature } = require('../webhookSecurity');

// ── SANDBOX (default 'null') ─────────────────────────────────────────────────
const sandboxProvider = {
  name: 'null',
  isSandbox: true,
  async sendTemplateMessage({ to }) {
    return { external_id: `sandbox-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'sent', to };
  },
  async getMessageStatus() { return { status: 'delivered' }; },
  verifyWebhookSignature() { return { valid: true }; }, // sandbox não assina
  parseWebhook(body = {}) {
    const ev = body.event_id || body.message_id || body.external_id || `wa-evt-${Date.now()}`;
    return { external_event_id: String(ev), updates: [{ external_id: body.external_id || body.message_id || null, status: body.status || 'delivered' }] };
  },
  estimateMessageCost(settings) { return Number(settings?.cost_per_message || 0); },
};

// ── META WhatsApp Cloud API (REAL) ───────────────────────────────────────────
function metaProvider({ fetchImpl, secretFn = getSecret } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const version = secretFn('META_GRAPH', 'API_VERSION') || process.env.META_GRAPH_API_VERSION || 'v20.0';
  const creds = () => ({
    token: secretFn('META_WHATSAPP', 'ACCESS_TOKEN'),
    phoneId: secretFn('META_WHATSAPP', 'PHONE_NUMBER_ID'),
    appSecret: secretFn('META', 'APP_SECRET'),
  });

  return {
    name: 'meta',
    isSandbox: false,

    // Mensagem de TEMPLATE (business-initiated exige template aprovado).
    async sendTemplateMessage({ to, provider_template_id, language = 'pt_BR', variables = {} }) {
      const { token, phoneId } = creds();
      if (!token || !phoneId) throw new Error('WhatsApp Meta sem credenciais (META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID).');
      if (!provider_template_id) throw new Error('Template do WhatsApp não aprovado/definido (provider_template_id ausente).');
      if (!doFetch) throw new Error('fetch indisponível no runtime.');

      // Parâmetros do corpo na ordem esperada pelo template.
      const params = Object.values(variables || {}).map((v) => ({ type: 'text', text: String(v) }));
      const payload = {
        messaging_product: 'whatsapp',
        to: String(to).replace(/\D/g, ''),
        type: 'template',
        template: { name: provider_template_id, language: { code: language }, components: params.length ? [{ type: 'body', parameters: params }] : [] },
      };
      const res = await doFetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (data && data.error) || {};
        const e = new Error(err.message || `Meta API ${res.status}`);
        e.code = err.code; e.details = err;
        throw e;
      }
      return { external_id: data.messages && data.messages[0] && data.messages[0].id, status: 'sent', to };
    },

    async getMessageStatus() { return { status: 'unknown' }; }, // status vem por webhook

    // Assinatura X-Hub-Signature-256 (HMAC do corpo bruto com META_APP_SECRET).
    verifyWebhookSignature(raw, headers = {}) {
      const { appSecret } = creds();
      const sig = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
      return { valid: verifyHmacSignature(raw, sig, appSecret) };
    },

    // Extrai atualizações de status do payload de webhook da Meta.
    parseWebhook(body = {}) {
      const updates = [];
      let eventId = body.entry && body.entry[0] && body.entry[0].id;
      try {
        for (const entry of body.entry || []) {
          for (const ch of entry.changes || []) {
            for (const st of (ch.value && ch.value.statuses) || []) {
              updates.push({ external_id: st.id, status: st.status }); // sent|delivered|read|failed
              eventId = eventId || st.id;
            }
          }
        }
      } catch (_) { /* payload inesperado */ }
      return { external_event_id: String(eventId || `meta-${Date.now()}`), updates };
    },

    estimateMessageCost(settings) { return Number(settings?.cost_per_message || 0); },
  };
}

function getWhatsAppProvider(settings = {}, deps = {}) {
  const p = (settings.whatsapp_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return sandboxProvider;
  if (p === 'meta') return metaProvider(deps);
  // Provedor não implementado → adapter que falha com clareza.
  return {
    name: p, isSandbox: false,
    async sendTemplateMessage() { throw new Error(`Provedor WhatsApp "${p}" não implementado.`); },
    verifyWebhookSignature() { return { valid: false }; },
    parseWebhook() { return { external_event_id: null, updates: [] }; },
    estimateMessageCost(s) { return Number(s?.cost_per_message || 0); },
  };
}

module.exports = { getWhatsAppProvider, sandboxProvider, metaProvider };
