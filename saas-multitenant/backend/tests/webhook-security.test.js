'use strict';
// =============================================================================
// C4 — Segurança de webhooks (raw-body + assinatura) e adapters reais
// (Meta WhatsApp, Asaas) com HTTP INJETADO (sem rede). Valida construção de
// requisição, parsing de resposta/erro e verificação de assinatura (§11/§12/§14).
// =============================================================================
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyHmacSignature, timestampFresh, hmacSha256Hex } = require('../services/automation/webhookSecurity');
const { metaProvider } = require('../services/automation/providers/whatsapp');
const { asaasProvider, sandboxProvider } = require('../services/automation/providers/payment');

// secretFn injetável (não usa process.env).
const secrets = {
  META_WHATSAPP_ACCESS_TOKEN: 'tok', META_WHATSAPP_PHONE_NUMBER_ID: '123', META_APP_SECRET: 'appsecret',
  PAYMENT_ASAAS_KEY: 'akey', PAYMENT_ASAAS_WEBHOOK_TOKEN: 'wtok', PAYMENT_ASAAS_BASE: 'https://sandbox.asaas.com/v3',
};
const secretFn = (scope, name) => secrets[`${scope}_${name}`.toUpperCase()];

test('webhookSecurity: HMAC válido/ inválido/ adulterado', () => {
  const raw = Buffer.from('{"a":1}');
  const good = 'sha256=' + hmacSha256Hex(raw, 'appsecret');
  assert.equal(verifyHmacSignature(raw, good, 'appsecret'), true);
  assert.equal(verifyHmacSignature(raw, good, 'outro'), false, 'segredo errado');
  assert.equal(verifyHmacSignature(Buffer.from('{"a":2}'), good, 'appsecret'), false, 'corpo adulterado');
  assert.equal(verifyHmacSignature(raw, 'sha256=deadbeef', 'appsecret'), false);
});

test('webhookSecurity: timestampFresh rejeita replay antigo', () => {
  const now = Date.now();
  assert.equal(timestampFresh(Math.floor(now / 1000), 300, now), true);
  assert.equal(timestampFresh(Math.floor((now - 10 * 60 * 1000) / 1000), 300, now), false);
});

test('Meta: verifyWebhookSignature usa HMAC do corpo bruto', () => {
  const p = metaProvider({ secretFn });
  const raw = Buffer.from(JSON.stringify({ entry: [{ id: 'e1' }] }));
  const sig = 'sha256=' + hmacSha256Hex(raw, 'appsecret');
  assert.equal(p.verifyWebhookSignature(raw, { 'x-hub-signature-256': sig }).valid, true);
  assert.equal(p.verifyWebhookSignature(raw, { 'x-hub-signature-256': 'sha256=bad' }).valid, false);
});

test('Meta: sendTemplateMessage monta a requisição da Graph API', async () => {
  let captured = null;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }; };
  const p = metaProvider({ secretFn, fetchImpl });
  const r = await p.sendTemplateMessage({ to: '+55 (21) 99999-0000', provider_template_id: 'cobranca', language: 'pt_BR', variables: { nome: 'Maria', valor: 'R$ 700,00' } });
  assert.equal(r.external_id, 'wamid.X');
  assert.match(captured.url, /graph\.facebook\.com\/.+\/123\/messages/);
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.type, 'template');
  assert.equal(body.to, '5521999990000');
  assert.equal(body.template.name, 'cobranca');
  assert.equal(body.template.components[0].parameters.length, 2);
});

test('Meta: sendTemplateMessage normaliza erro da API', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Template not approved', code: 132 } }) });
  const p = metaProvider({ secretFn, fetchImpl });
  await assert.rejects(() => p.sendTemplateMessage({ to: '5511', provider_template_id: 't' }), /Template not approved/);
});

test('Meta: parseWebhook extrai status de mensagens', () => {
  const p = metaProvider({ secretFn });
  const body = { entry: [{ id: 'e1', changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }, { id: 'wamid.2', status: 'read' }] } }] }] };
  const parsed = p.parseWebhook(body);
  assert.equal(parsed.updates.length, 2);
  assert.equal(parsed.updates[0].status, 'delivered');
});

test('Asaas: verifyWebhookSignature por token de header', () => {
  const p = asaasProvider({ secretFn });
  assert.equal(p.verifyWebhookSignature('{}', { 'asaas-access-token': 'wtok' }).valid, true);
  assert.equal(p.verifyWebhookSignature('{}', { 'asaas-access-token': 'errado' }).valid, false);
  assert.equal(p.verifyWebhookSignature('{}', {}).valid, false);
});

test('Asaas: createCharge monta requisição e mapeia PIX; parseWebhook mapeia status', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/payments')) return { ok: true, json: async () => ({ id: 'pay_1', status: 'PENDING', invoiceUrl: 'http://inv' }) };
    if (url.endsWith('/pixQrCode')) return { ok: true, json: async () => ({ payload: 'PIX-COPIA-COLA', expirationDate: '2027-01-01' }) };
    return { ok: true, json: async () => ({}) };
  };
  const p = asaasProvider({ secretFn, fetchImpl });
  const chg = await p.createCharge({ amount: 700, due_date: '2027-01-05', external_customer_id: 'cus_1', description: 'Locação' });
  assert.equal(chg.external_id, 'pay_1');
  assert.equal(chg.status, 'pending');
  assert.equal(chg.pix_code, 'PIX-COPIA-COLA');
  assert.equal(JSON.parse(calls[0].opts.body).customer, 'cus_1');
  assert.equal(calls[0].opts.headers.access_token, 'akey');

  const parsed = p.parseWebhook({ id: 'evt_9', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1', status: 'RECEIVED', value: 700 } });
  assert.equal(parsed.charge_external_id, 'pay_1');
  assert.equal(parsed.status, 'paid');
});

test('Asaas: sem credenciais, createCharge falha com clareza', async () => {
  const p = asaasProvider({ secretFn: () => null });
  await assert.rejects(() => p.createCharge({ amount: 1, external_customer_id: 'c' }), /credenciais/);
});

test('sandbox de pagamento continua válido (sem assinatura)', () => {
  assert.equal(sandboxProvider.verifyWebhookSignature('{}', {}).valid, true);
  assert.equal(sandboxProvider.parseWebhook({ charge_external_id: 'x', status: 'paid' }).status, 'paid');
});
