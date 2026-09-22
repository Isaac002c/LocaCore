'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const { getSecret } = require('../secrets');
const { safeEqual } = require('../webhookSecurity');
const { assertSandboxAllowed, sandboxSignatureResult } = require('./guard');
const { toISODate } = require('../../../utils/date');

const digits = (value) => String(value || '').replace(/\D/g, '');
const money = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
const toCents = (value) => Math.round(Number(value || 0) * 100);

// Tokens do Inter valem 60 minutos. O cache evita gerar um token por cobrança
// (o próprio Inter limita o endpoint de OAuth) e fica somente em memória.
const interTokenCache = new Map();
const interWebhookCache = new Map();

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

// PIX direto, sem checkout externo. O LocaCore gera a cobrança interna e envia
// a chave configurada; a baixa só acontece pela confirmação manual de um
// usuário autorizado. Não existe webhook nem tentativa de "adivinhar" o
// pagamento, portanto este provider continua fail-closed.
function manualPixProvider({ settings = {} } = {}) {
  const cfg = settings.payment_config || {};
  const pixKey = () => String(cfg.pix_key || '').trim();
  const receiverName = () => String(cfg.pix_receiver_name || '').trim();
  const assertConfigured = () => {
    if (!pixKey() || pixKey().length > 140) {
      throw providerError('Chave PIX para confirmação manual não configurada.', 'MISSING_PIX_KEY');
    }
  };

  return {
    name: 'manual_pix',
    isSandbox: false,
    supportsExternalCustomer: false,
    requiresManualConfirmation: true,
    async createCharge({ amount, due_date, public_id }) {
      assertConfigured();
      if (!public_id) throw providerError('Identificador interno da cobrança ausente.', 'MISSING_ORDER_NSU');
      return {
        external_id: `manual:${public_id}`,
        status: 'waiting_payment',
        pix_code: pixKey(),
        payment_link: null,
        expires_at: due_date ? new Date(`${toISODate(due_date)}T23:59:59Z`).toISOString() : null,
        amount: money(amount),
        provider_metadata: {
          confirmation_mode: 'manual',
          receiver_name: receiverName() || null,
        },
      };
    },
    verifyWebhookSignature() { return { valid: false, requiresProviderVerification: false }; },
    parseWebhook() { return { external_event_id: null, status: 'waiting_payment' }; },
    async verifyPayment() {
      throw providerError('PIX direto exige confirmação manual por usuário autorizado.', 'MANUAL_CONFIRMATION_REQUIRED');
    },
    async testConnection() {
      assertConfigured();
      const key = pixKey();
      return {
        ok: true,
        mode: 'manual_confirmation',
        pix_key_masked: key.length <= 6 ? '***' : `${key.slice(0, 3)}***${key.slice(-3)}`,
        receiver_name: receiverName() || null,
      };
    },
  };
}

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

function decodePem(value) {
  if (!value) return null;
  const raw = String(value).trim().replace(/\\n/g, '\n');
  if (raw.includes('-----BEGIN ')) return raw;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN ') ? decoded : raw;
  } catch (_) { return raw; }
}

function decodePfx(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  try { return Buffer.from(String(value).trim(), 'base64'); }
  catch (_) { return null; }
}

function interTls(secretFn, preferredFormat = null) {
  const pfx = decodePfx(secretFn('PAYMENT_INTER', 'PFX_BASE64') || secretFn('PAYMENT_INTER', 'PFX'));
  const cert = decodePem(secretFn('PAYMENT_INTER', 'CERTIFICATE') || secretFn('PAYMENT_INTER', 'CERT'));
  const key = decodePem(secretFn('PAYMENT_INTER', 'PRIVATE_KEY') || secretFn('PAYMENT_INTER', 'KEY'));
  if (preferredFormat === 'pem' && cert && key) return { cert, key, rejectUnauthorized: true };
  if (preferredFormat === 'pfx' && pfx?.length) {
    return { pfx, passphrase: secretFn('PAYMENT_INTER', 'PFX_PASSWORD') || undefined, rejectUnauthorized: true };
  }
  if (cert && key) return { cert, key, rejectUnauthorized: true };
  if (pfx?.length) return { pfx, passphrase: secretFn('PAYMENT_INTER', 'PFX_PASSWORD') || undefined, rejectUnauthorized: true };
  throw providerError('Certificado mTLS do Inter ausente. Envie PFX ou certificado e chave privada.', 'MISSING_MTLS_CERTIFICATE');
}

// Transporte HTTPS pequeno e explícito para suportar mTLS sem desabilitar a
// validação TLS. O limite de resposta evita consumo de memória por upstream.
function httpsJsonRequest({ url, method = 'GET', headers = {}, body = null, tls = {}, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
    const req = https.request({
      protocol: target.protocol, hostname: target.hostname,
      port: target.port || 443, path: `${target.pathname}${target.search}`,
      method, headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) },
      timeout: timeoutMs, ...tls,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) req.destroy(new Error('Resposta do Inter excedeu 2 MB.'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = {};
        if (text) {
          try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 2000) }; }
        }
        const status = Number(res.statusCode || 0);
        resolve({ ok: status >= 200 && status < 300, status, data, headers: res.headers });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout ao acessar o Inter.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function interProvider({ requestImpl, secretFn = getSecret, settings = {}, nowFn = () => Date.now() } = {}) {
  const transport = requestImpl || httpsJsonRequest;
  const cfg = settings.payment_config || {};
  const environment = String(cfg.environment || 'production').toLowerCase();
  const defaultBase = environment === 'sandbox'
    ? 'https://cdpj-sandbox.partners.uatinter.co'
    : 'https://cdpj.partners.bancointer.com.br';
  // URLs não vêm das configurações editáveis do tenant: isso impediria que um
  // administrador apontasse o mTLS/Client Secret para um host arbitrário.
  // Overrides existem somente por variável de ambiente confiável (sandbox/tests).
  const base = String(secretFn('PAYMENT_INTER', 'BASE') || defaultBase).replace(/\/$/, '');
  const tokenUrl = String(secretFn('PAYMENT_INTER', 'TOKEN_URL') || `${base}/oauth/v2/token`);
  const pixKey = () => String(cfg.pix_key || secretFn('PAYMENT_INTER', 'PIX_KEY') || '').trim();
  const clientId = () => secretFn('PAYMENT_INTER', 'CLIENT_ID');
  const clientSecret = () => secretFn('PAYMENT_INTER', 'CLIENT_SECRET');
  const account = () => String(cfg.account_number || secretFn('PAYMENT_INTER', 'ACCOUNT_NUMBER') || '').trim();
  const webhookUrl = () => String(cfg.webhook_url || (process.env.BASE_URL
    ? `${String(process.env.BASE_URL).replace(/\/$/, '')}/webhooks/payment/inter` : '')).trim();
  const scope = String(cfg.scope || 'cob.write cob.read pix.read webhook.read webhook.write');

  const credentials = () => {
    if (!clientId() || !clientSecret()) {
      throw providerError('Client ID/Secret do Inter ausentes.', 'NO_CREDENTIALS');
    }
    if (!pixKey()) throw providerError('Chave PIX do Inter ausente.', 'MISSING_PIX_KEY');
    return { tls: interTls(secretFn, cfg.certificate_format) };
  };

  const send = async (request) => {
    try {
      const response = await transport(request);
      if (response && typeof response.json === 'function') {
        return { ok: !!response.ok, status: Number(response.status || 0), data: await response.json().catch(() => ({})), headers: response.headers || {} };
      }
      return { ok: !!response?.ok, status: Number(response?.status || 0), data: response?.data || {}, headers: response?.headers || {} };
    } catch (err) {
      throw providerError(`Inter indisponivel: ${err.message}`, 'NETWORK_ERROR', { retryable: true });
    }
  };

  const tokenCacheKey = () => `${base}:${clientId()}`;
  const token = async ({ force = false } = {}) => {
    const { tls } = credentials();
    const cacheKey = tokenCacheKey();
    const cached = interTokenCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > nowFn() + 30000) return cached.value;
    const form = new URLSearchParams({
      client_id: clientId(), client_secret: clientSecret(),
      scope, grant_type: 'client_credentials',
    }).toString();
    const response = await send({
      url: tokenUrl, method: 'POST', tls,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form,
    });
    if (!response.ok || !response.data?.access_token) {
      throw providerError(response.data?.detail || response.data?.title || `Inter OAuth HTTP ${response.status}`,
        `OAUTH_HTTP_${response.status}`, { retryable: response.status >= 500 || response.status === 429, details: response.data });
    }
    const ttl = Math.max(60, Number(response.data.expires_in || 3600));
    interTokenCache.set(cacheKey, { value: response.data.access_token, expiresAt: nowFn() + ttl * 1000 });
    return response.data.access_token;
  };

  const api = async (path, { method = 'GET', payload = null, retryAuth = true } = {}) => {
    const { tls } = credentials();
    const accessToken = await token();
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
    if (payload != null) headers['Content-Type'] = 'application/json';
    if (account()) headers['x-conta-corrente'] = account();
    const response = await send({
      url: `${base}${path}`, method, tls, headers,
      body: payload == null ? null : JSON.stringify(payload),
    });
    if (response.status === 401 && retryAuth) {
      interTokenCache.delete(tokenCacheKey());
      await token({ force: true });
      return api(path, { method, payload, retryAuth: false });
    }
    if (!response.ok) {
      const message = response.data?.detail || response.data?.title || response.data?.violacoes?.[0]?.razao
        || `Inter HTTP ${response.status}`;
      throw providerError(message, `HTTP_${response.status}`, {
        retryable: response.status >= 500 || response.status === 429, details: response.data,
      });
    }
    return response.data || {};
  };

  const ensureWebhook = async () => {
    const url = webhookUrl();
    if (!url || !/^https:\/\//i.test(url)) {
      throw providerError('URL HTTPS publica do webhook Inter nao configurada.', 'MISSING_WEBHOOK_URL');
    }
    const cacheKey = `${base}:${pixKey()}:${url}`;
    const readyUntil = interWebhookCache.get(cacheKey);
    if (readyUntil && readyUntil > nowFn()) return url;
    await api(`/pix/v2/webhook/${encodeURIComponent(pixKey())}`, {
      method: 'PUT', payload: { webhookUrl: url },
    });
    interWebhookCache.set(cacheKey, nowFn() + 10 * 60 * 1000);
    return url;
  };

  const txidFor = (publicId) => crypto.createHash('sha256').update(`locacore:${publicId}`).digest('hex').slice(0, 32).toUpperCase();
  const expirationFor = (dueDate) => {
    const configured = Number(cfg.expiration_seconds || 0);
    if (configured > 0) return Math.max(60, Math.min(configured, 30 * 86400));
    const due = dueDate ? new Date(`${toISODate(dueDate)}T23:59:59-03:00`).getTime() : nowFn() + 86400000;
    // Vencimento financeiro e expiração do QR são independentes. Mantemos o QR
    // pagável por ao menos sete dias para que os lembretes não levem um código
    // expirado; a cobrança ainda fica "atrasada" no LocaCore na data correta.
    return Math.max(7 * 86400, Math.min(Math.ceil((due - nowFn()) / 1000), 30 * 86400));
  };

  return {
    name: 'inter',
    isSandbox: environment === 'sandbox',
    supportsExternalCustomer: false,
    idempotentCreate: true,
    async createCharge({ amount, due_date, description, public_id, client = {} }) {
      credentials();
      if (!public_id) throw providerError('Identificador interno da cobranca ausente.', 'MISSING_ORDER_NSU');
      await ensureWebhook();
      const txid = txidFor(public_id);
      const document = digits(client.cpf || client.cpf_cnpj || client.document);
      const debtor = client.name && [11, 14].includes(document.length)
        ? { nome: String(client.name).slice(0, 200), ...(document.length === 11 ? { cpf: document } : { cnpj: document }) }
        : undefined;
      const payload = {
        calendario: { expiracao: expirationFor(due_date) },
        valor: { original: money(amount), modalidadeAlteracao: 0 },
        chave: pixKey(),
        solicitacaoPagador: String(description || `Locacao ${public_id}`).slice(0, 140),
        devedor: debtor,
        infoAdicionais: [
          { nome: 'LocaCore', valor: String(public_id).slice(0, 200) },
        ],
      };
      const data = await api(`/pix/v2/cob/${txid}`, { method: 'PUT', payload });
      if (!data.pixCopiaECola) {
        throw providerError('Inter nao devolveu o PIX copia e cola.', 'INVALID_PROVIDER_RESPONSE', { details: data });
      }
      const createdAt = data.calendario?.criacao ? new Date(data.calendario.criacao).getTime() : nowFn();
      const expiresIn = Number(data.calendario?.expiracao || payload.calendario.expiracao);
      return {
        external_id: data.txid || txid,
        status: String(data.status || '').toUpperCase() === 'CONCLUIDA' ? 'paid' : 'waiting_payment',
        pix_code: data.pixCopiaECola,
        payment_link: data.location || data.loc?.location || null,
        expires_at: new Date(createdAt + expiresIn * 1000).toISOString(),
        amount: money(amount),
        provider_metadata: {
          txid: data.txid || txid, public_id, location: data.location || data.loc?.location || null,
          receiver_name: String(cfg.receiver_name || cfg.pix_receiver_name || 'Rental Log Service'),
          environment, webhook_url: webhookUrl(),
        },
      };
    },
    // O Inter autentica callbacks por certificado de cliente no transporte.
    // Como o TLS pode terminar no proxy, tratamos o callback apenas como aviso:
    // a baixa depende obrigatoriamente do GET mTLS no banco em verifyPayment.
    verifyWebhookSignature() { return { valid: true, unsigned: true, requiresProviderVerification: true }; },
    parseWebhook(body = {}) {
      const pix = Array.isArray(body.pix) ? body.pix[0] || {} : body;
      const txid = pix.txid || body.txid || null;
      const e2e = pix.endToEndId || pix.end_to_end_id || body.endToEndId || null;
      const eventHash = crypto.createHash('sha256').update(JSON.stringify(pix)).digest('hex');
      return {
        external_event_id: String(e2e || `${txid || 'unknown'}:${eventHash}`),
        charge_external_id: txid,
        charge_public_id: null,
        transaction_nsu: e2e,
        status: txid ? 'paid' : 'waiting_payment',
        amount: pix.valor != null ? Number(pix.valor) : null,
        raw: body,
      };
    },
    splitWebhook(body = {}) {
      return Array.isArray(body.pix) && body.pix.length > 1
        ? body.pix.slice(0, 100).map((pix) => ({ pix: [pix] }))
        : [body];
    },
    async verifyPayment({ charge, webhook }) {
      const txid = charge.external_id || charge.provider_metadata?.txid || webhook.charge_external_id;
      if (!txid) throw providerError('Cobranca Inter sem txid.', 'MISSING_TXID');
      const data = await api(`/pix/v2/cob/${encodeURIComponent(txid)}`);
      const received = Array.isArray(data.pix) ? data.pix : [];
      const paidAmount = received.reduce((sum, pix) => sum + Number(pix.valor || 0), 0);
      const concluded = String(data.status || '').toUpperCase() === 'CONCLUIDA';
      return {
        verified: concluded && received.length > 0,
        paid: concluded && received.length > 0,
        amount: received.length ? paidAmount : null,
        paid_amount: received.length ? paidAmount : null,
        provider_status: data.status || null,
        transaction_nsu: received[0]?.endToEndId || webhook.transaction_nsu || null,
        receipt_url: null,
      };
    },
    async testConnection() {
      credentials();
      await token({ force: true });
      const registered = await ensureWebhook();
      const key = pixKey();
      return {
        ok: true, environment, webhook_registered: registered,
        pix_key_masked: key.length <= 6 ? '***' : `${key.slice(0, 3)}***${key.slice(-3)}`,
        account_configured: !!account(),
      };
    },
  };
}

function getPaymentProvider(settings = {}, deps = {}) {
  const p = String(settings.payment_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return sandboxProvider;
  if (p === 'manual_pix') return manualPixProvider({ settings });
  if (p === 'asaas') return asaasProvider(deps);
  if (p === 'infinitepay') return infinitePayProvider({ ...deps, settings });
  if (p === 'inter') return interProvider({ ...deps, settings });
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
  getPaymentProvider, sandboxProvider, manualPixProvider, asaasProvider, infinitePayProvider,
  interProvider, httpsJsonRequest, providerError, toCents,
};
