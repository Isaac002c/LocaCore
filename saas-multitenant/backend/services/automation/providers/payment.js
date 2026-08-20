'use strict';

const crypto = require('node:crypto');
const { getSecret } = require('../secrets');
const { safeEqual } = require('../webhookSecurity');
const { assertSandboxAllowed, sandboxSignatureResult } = require('./guard');
const { toISODate } = require('../../../utils/date');

const digits = (value) => String(value || '').replace(/\D/g, '');
const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
const toCents = (value) => Math.round(Number(value || 0) * 100);

function providerError(message, code, { retryable = false, details = null } = {}) {
  const err = new Error(message);
  err.code = code;
  err.retryable = retryable;
  err.details = details;
  return err;
}

const sandboxProvider = {
  name: 'null',
  isSandbox: true,
  supportsExternalCustomer: false,
  async createCharge({ amount, due_date, public_id }) {
    assertSandboxAllowed('Cobranca/PIX');
    const id = public_id || `sandbox-chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      external_id: id,
      status: 'pending',
      pix_code: `00020126SANDBOX-${id}5204000053039865802BR`,
      payment_link: null,
      expires_at: due_date ? new Date(`${toISODate(due_date)}T23:59:59Z`).toISOString() : null,
      amount: money(amount),
      provider_metadata: {},
    };
  },
  verifyWebhookSignature() { return sandboxSignatureResult(); },
  parseWebhook(body = {}) {
    const ev = body.event_id || body.id || `pay-evt-${Date.now()}`;
    return {
      external_event_id: String(ev),
      charge_external_id: body.charge_external_id || body.external_id || body.charge_id || null,
      charge_public_id: body.order_nsu || null,
      transaction_nsu: body.transaction_nsu || null,
      status: body.status || 'paid',
      amount: body.amount != null ? Number(body.amount) : null,
      raw: body,
    };
  },
  async verifyPayment({ charge, webhook }) {
    assertSandboxAllowed('Confirmacao de pagamento');
    return { verified: webhook.status === 'paid', paid: webhook.status === 'paid', amount: Number(webhook.amount ?? charge.amount), provider_status: webhook.status };
  },
  async testConnection() { assertSandboxAllowed('Teste de cobranca'); return { ok: true, mode: 'sandbox' }; },
};

function asaasProvider({ fetchImpl, secretFn = getSecret } = {}) {
  const doFetch = fetchImpl || global.fetch;
  const base = secretFn('PAYMENT_ASAAS', 'BASE') || 'https://api.asaas.com/v3';
  const key = () => secretFn('PAYMENT_ASAAS', 'KEY');
  const webhookToken = () => secretFn('PAYMENT_ASAAS', 'WEBHOOK_TOKEN');

  const api = async (path, opts = {}) => {
    const apiKey = key();
    if (!apiKey) throw providerError('Cobranca Asaas sem credenciais.', 'NO_CREDENTIALS');
    if (!doFetch) throw providerError('fetch indisponivel no runtime.', 'NO_FETCH');
    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...opts,
        headers: { access_token: apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) },
      });
    } catch (err) {
      throw providerError(`Asaas indisponivel: ${err.message}`, 'NETWORK_ERROR', { retryable: true });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.errors?.[0]?.description || `Asaas HTTP ${response.status}`;
      throw providerError(message, `HTTP_${response.status}`, { retryable: response.status >= 500 || response.status === 429, details: data });
    }
    return data;
  };

  return {
    name: 'asaas',
    isSandbox: false,
    supportsExternalCustomer: true,
    async createCustomer({ name, cpfCnpj, email, phone }) {
      const doc = digits(cpfCnpj);
      if (!doc) throw providerError('Cliente sem CPF/CNPJ.', 'MISSING_CUSTOMER_DOCUMENT');
      const data = await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: name || 'Cliente', cpfCnpj: doc, email: email || undefined,
          mobilePhone: digits(phone) || undefined, notificationDisabled: true,
        }),
      });
      return { external_id: data.id };
    },
    async createCharge({ amount, due_date, external_customer_id, description, public_id }) {
      if (!external_customer_id) throw providerError('Cliente externo do Asaas ausente.', 'MISSING_EXTERNAL_CUSTOMER');
      const payment = await api('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customer: external_customer_id, billingType: 'PIX', value: Number(amount),
          dueDate: toISODate(due_date), description, externalReference: public_id || undefined,
        }),
      });
      let pix = {};
      try { pix = await api(`/payments/${payment.id}/pixQrCode`); } catch (_) { /* link ainda e valido */ }
      return {
        external_id: payment.id,
        status: ['RECEIVED', 'CONFIRMED'].includes(payment.status) ? 'paid' : 'pending',
        pix_code: pix.payload || null,
        payment_link: payment.invoiceUrl || null,
        expires_at: pix.expirationDate || null,
        amount: money(amount),
        provider_metadata: { provider_status: payment.status || null },
      };
    },
    verifyWebhookSignature(raw, headers = {}) {
      const expected = webhookToken();
      const provided = headers['asaas-access-token'] || headers['Asaas-Access-Token'];
      return { valid: !!expected && safeEqual(provided, expected), requiresProviderVerification: true };
    },
    parseWebhook(body = {}) {
      const p = body.payment || {};
      const map = { RECEIVED: 'paid', CONFIRMED: 'paid', OVERDUE: 'overdue', DELETED: 'cancelled', REFUNDED: 'cancelled' };
      return {
        external_event_id: String(body.id || (p.id ? `${p.id}:${body.event}` : crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'))),
        charge_external_id: p.id || null,
        charge_public_id: p.externalReference || null,
        transaction_nsu: p.id || null,
        status: map[p.status] || (body.event?.includes('RECEIVED') ? 'paid' : 'waiting_payment'),
        amount: p.value != null ? Number(p.value) : null,
        raw: body,
      };
    },
    async verifyPayment({ charge }) {
      const payment = await api(`/payments/${encodeURIComponent(charge.external_id)}`);
      const paid = ['RECEIVED', 'CONFIRMED'].includes(payment.status);
      return {
        verified: true,
        paid,
        amount: Number(payment.value),
        provider_status: payment.status,
        transaction_nsu: payment.id,
      };
    },
    async testConnection() {
      await api('/myAccount');
      return { ok: true };
    },
  };
}

function infinitePayProvider({ fetchImpl, secretFn = getSecret, settings = {} } = {}) {
  const doFetch = fetchImpl || global.fetch;
  const cfg = settings.payment_config || {};
  const base = String(cfg.api_url || secretFn('PAYMENT_INFINITEPAY', 'BASE') || 'https://api.checkout.infinitepay.io').replace(/\/$/, '');
  const handle = () => cfg.handle || cfg.infinitepay_handle || secretFn('PAYMENT_INFINITEPAY', 'HANDLE');

  const request = async (path, payload) => {
    if (!handle()) throw providerError('InfiniteTag da InfinitePay nao configurada.', 'MISSING_HANDLE');
    if (!doFetch) throw providerError('fetch indisponivel no runtime.', 'NO_FETCH');
    let response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    } catch (err) {
      throw providerError(`InfinitePay indisponivel: ${err.message}`, 'NETWORK_ERROR', { retryable: true });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw providerError(data.message || data.error || `InfinitePay HTTP ${response.status}`, `HTTP_${response.status}`, {
        retryable: response.status >= 500 || response.status === 429,
        details: data,
      });
    }
    return data;
  };

  return {
    name: 'infinitepay',
    isSandbox: false,
    supportsExternalCustomer: false,
    async createCharge({ amount, description, public_id, client = {} }) {
      if (!public_id) throw providerError('Identificador interno da cobranca ausente.', 'MISSING_ORDER_NSU');
      const webhookUrl = cfg.webhook_url || (process.env.BASE_URL ? `${String(process.env.BASE_URL).replace(/\/$/, '')}/webhooks/infinitepay` : null);
      if (!webhookUrl) throw providerError('URL publica do webhook InfinitePay nao configurada.', 'MISSING_WEBHOOK_URL');
      const payload = {
        handle: handle(),
        order_nsu: public_id,
        webhook_url: webhookUrl,
        redirect_url: cfg.redirect_url || undefined,
        items: [{ quantity: 1, price: toCents(amount), description: String(description || `Locacao ${public_id}`).slice(0, 255) }],
        customer: client?.name ? {
          name: client.name,
          email: client.email || undefined,
          phone_number: client.phone ? `+${digits(client.phone)}` : undefined,
        } : undefined,
      };
      const data = await request('/links', payload);
      const url = data.url || data.checkout_url;
      if (!url) throw providerError('InfinitePay nao devolveu o link de checkout.', 'INVALID_PROVIDER_RESPONSE', { details: data });
      let invoiceSlug = data.invoice_slug || data.slug || null;
      if (!invoiceSlug) {
        try { invoiceSlug = new URL(url).pathname.split('/').filter(Boolean).pop() || null; } catch (_) { /* ignore */ }
      }
      return {
        external_id: public_id,
        status: 'waiting_payment',
        pix_code: null,
        payment_link: url,
        expires_at: null,
        amount: money(amount),
        provider_metadata: { invoice_slug: invoiceSlug },
      };
    },
    // A documentacao publica nao oferece assinatura. Este retorno nunca significa
    // pagamento confirmado: payment_check abaixo e obrigatorio (fail closed).
    verifyWebhookSignature() { return { valid: true, unsigned: true, requiresProviderVerification: true }; },
    parseWebhook(body = {}) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      return {
        external_event_id: String(body.transaction_nsu || `${body.order_nsu || 'unknown'}:${hash}`),
        charge_external_id: null,
        charge_public_id: body.order_nsu || null,
        transaction_nsu: body.transaction_nsu || null,
        invoice_slug: body.invoice_slug || body.slug || null,
        receipt_url: body.receipt_url || null,
        status: body.transaction_nsu ? 'paid' : 'waiting_payment',
        amount: body.amount != null ? Number(body.amount) / 100 : null,
        paid_amount: body.paid_amount != null ? Number(body.paid_amount) / 100 : null,
        capture_method: body.capture_method || null,
        raw: body,
      };
    },
    async verifyPayment({ charge, webhook }) {
      const transaction = webhook.transaction_nsu || charge.transaction_nsu;
      const slug = webhook.invoice_slug || charge.provider_metadata?.invoice_slug;
      if (!transaction || !slug) {
        throw providerError('Webhook InfinitePay sem transaction_nsu ou invoice_slug.', 'INCOMPLETE_WEBHOOK');
      }
      const data = await request('/payment_check', {
        handle: handle(), order_nsu: charge.public_id,
        transaction_nsu: transaction, slug,
      });
      return {
        verified: data.success === true,
        paid: data.success === true && data.paid === true,
        amount: data.amount != null ? Number(data.amount) / 100 : null,
        paid_amount: data.paid_amount != null ? Number(data.paid_amount) / 100 : null,
        provider_status: data.paid ? 'paid' : 'not_paid',
        transaction_nsu: transaction,
        receipt_url: data.receipt_url || webhook.receipt_url || null,
      };
    },
    async testConnection() {
      if (!handle()) return { ok: false, error: 'InfiniteTag ausente' };
      return { ok: true, validated: 'configuration', handle_masked: `${String(handle()).slice(0, 2)}***` };
    },
  };
}

function getPaymentProvider(settings = {}, deps = {}) {
  const p = String(settings.payment_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return sandboxProvider;
  if (p === 'asaas') return asaasProvider(deps);
  if (p === 'infinitepay') return infinitePayProvider({ ...deps, settings });
  return {
    name: p, isSandbox: false, supportsExternalCustomer: false,
    async createCharge() { throw providerError(`Provedor de cobranca "${p}" nao implementado.`, 'NOT_IMPLEMENTED'); },
    verifyWebhookSignature() { return { valid: false }; },
    parseWebhook() { return { external_event_id: null }; },
    async verifyPayment() { throw providerError(`Provedor "${p}" sem conciliacao.`, 'NOT_IMPLEMENTED'); },
    async testConnection() { return { ok: false, error: 'Provedor nao implementado' }; },
  };
}

module.exports = {
  getPaymentProvider, sandboxProvider, asaasProvider, infinitePayProvider,
  providerError, toCents,
};
