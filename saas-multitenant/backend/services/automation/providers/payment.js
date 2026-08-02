// =============================================================================
// providers/payment.js — PaymentProvider (desacoplado): cobrança/PIX.
//   createCharge, verifyWebhookSignature(raw,headers), parseWebhook
// 'null'  = SANDBOX (PIX fictício; sem chamada externa; sem assinatura).
// 'asaas' = Asaas REAL (API v3), credenciais por env:
//   PAYMENT_ASAAS_KEY, PAYMENT_ASAAS_WEBHOOK_TOKEN, PAYMENT_ASAAS_BASE (sandbox/prod).
// =============================================================================

const { getSecret } = require('../secrets');
const { safeEqual } = require('../webhookSecurity');
const { assertSandboxAllowed, sandboxSignatureResult } = require('./guard');
// due_date pode vir do banco como objeto Date: coerção segura para 'YYYY-MM-DD'
// (o provedor rejeita "Wed Jul 29"). Ver utils/date.js.
const { toISODate } = require('../../../utils/date');

// Em PRODUÇÃO o sandbox é bloqueado (§16): não gera PIX fictício nem valida webhook.
const sandboxProvider = {
  name: 'null',
  isSandbox: true,
  async createCharge({ amount, due_date }) {
    assertSandboxAllowed('Cobrança/PIX');
    const id = `sandbox-chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      external_id: id, status: 'pending',
      pix_code: `00020126SANDBOX-${id}5204000053039865802BR`,
      payment_link: null,
      expires_at: due_date ? new Date(`${toISODate(due_date)}T23:59:59Z`).toISOString() : null,
      amount,
    };
  },
  verifyWebhookSignature() { return sandboxSignatureResult(); },
  parseWebhook(body = {}) {
    const ev = body.event_id || body.id || `pay-evt-${Date.now()}`;
    return {
      external_event_id: String(ev),
      charge_external_id: body.charge_external_id || body.external_id || body.charge_id || null,
      status: body.status || 'paid',
      amount: body.amount != null ? Number(body.amount) : null,
    };
  },
};

// ── ASAAS (REAL) ─────────────────────────────────────────────────────────────
function asaasProvider({ fetchImpl, secretFn = getSecret } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const base = secretFn('PAYMENT_ASAAS', 'BASE') || 'https://api.asaas.com/v3';
  const key = () => secretFn('PAYMENT_ASAAS', 'KEY');
  const webhookToken = () => secretFn('PAYMENT_ASAAS', 'WEBHOOK_TOKEN');

  const api = async (path, opts = {}) => {
    const apiKey = key();
    if (!apiKey) throw new Error('Cobrança Asaas sem credenciais (PAYMENT_ASAAS_KEY).');
    if (!doFetch) throw new Error('fetch indisponível no runtime.');
    const res = await doFetch(`${base}${path}`, {
      ...opts,
      headers: { access_token: apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((data.errors && data.errors[0] && data.errors[0].description) || `Asaas ${res.status}`); e.details = data; throw e; }
    return data;
  };

  return {
    name: 'asaas',
    isSandbox: false,
    // Cria (ou identifica) o cliente no Asaas. cpfCnpj é OBRIGATÓRIO na API do
    // Asaas — sem ele, a cobrança não pode ser gerada. Devolve o id do customer.
    async createCustomer({ name, cpfCnpj, email, phone }) {
      const doc = String(cpfCnpj || '').replace(/\D/g, '');
      if (!doc) throw new Error('Cliente sem CPF/CNPJ — o Asaas exige o documento para criar o customer.');
      const data = await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: name || 'Cliente',
          cpfCnpj: doc,
          email: email || undefined,
          mobilePhone: String(phone || '').replace(/\D/g, '') || undefined,
          notificationDisabled: true, // as notificações saem pelo WhatsApp do LocaCore
        }),
      });
      return { external_id: data.id };
    },
    // Requer external_customer_id (cliente já criado no Asaas) — evita duplicar cliente.
    async createCharge({ amount, due_date, external_customer_id, description }) {
      if (!external_customer_id) throw new Error('Cliente externo (Asaas customer id) ausente — crie/vincule antes.');
      const payment = await api('/payments', {
        method: 'POST',
        body: JSON.stringify({ customer: external_customer_id, billingType: 'PIX', value: Number(amount), dueDate: toISODate(due_date), description }),
      });
      // Busca o QR/copia-e-cola do PIX.
      let pix = {};
      try { pix = await api(`/payments/${payment.id}/pixQrCode`); } catch (_) { /* opcional */ }
      return {
        external_id: payment.id,
        status: payment.status === 'RECEIVED' || payment.status === 'CONFIRMED' ? 'paid' : 'pending',
        pix_code: pix.payload || null,
        payment_link: payment.invoiceUrl || null,
        expires_at: pix.expirationDate || null,
        amount,
      };
    },
    // Asaas autentica webhook por token de header (não HMAC).
    verifyWebhookSignature(raw, headers = {}) {
      const expected = webhookToken();
      if (!expected) return { valid: false };
      const provided = headers['asaas-access-token'] || headers['Asaas-Access-Token'];
      return { valid: safeEqual(provided, expected) };
    },
    parseWebhook(body = {}) {
      const p = body.payment || {};
      const map = { RECEIVED: 'paid', CONFIRMED: 'paid', OVERDUE: 'expired', DELETED: 'canceled', REFUNDED: 'canceled' };
      return {
        external_event_id: String(body.id || (p.id ? `${p.id}:${body.event}` : `asaas-${Date.now()}`)),
        charge_external_id: p.id || null,
        status: map[p.status] || (body.event && body.event.includes('RECEIVED') ? 'paid' : 'pending'),
        amount: p.value != null ? Number(p.value) : null,
      };
    },
  };
}

function getPaymentProvider(settings = {}, deps = {}) {
  const p = (settings.payment_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return sandboxProvider;
  if (p === 'asaas') return asaasProvider(deps);
  return {
    name: p, isSandbox: false,
    async createCharge() { throw new Error(`Provedor de cobrança "${p}" não implementado.`); },
    verifyWebhookSignature() { return { valid: false }; },
    parseWebhook() { return { external_event_id: null }; },
  };
}

module.exports = { getPaymentProvider, sandboxProvider, asaasProvider };
