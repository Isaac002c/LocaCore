'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { interProvider } = require('../services/automation/providers/payment');

function makeProvider(overrides = {}) {
  const clientId = `client-${randomUUID()}`;
  const values = {
    CLIENT_ID: clientId,
    CLIENT_SECRET: 'secret-test',
    CERTIFICATE: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
    PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----',
  };
  const calls = [];
  const provider = interProvider({
    settings: { payment_config: {
      environment: 'production', pix_key: '45427279000122',
      receiver_name: 'Rental Log Service', account_number: '12345678',
      webhook_url: 'https://locacore.example/webhooks/payment/inter',
      ...overrides.payment_config,
    } },
    secretFn: (_scope, name) => values[name] || null,
    nowFn: () => Date.parse('2026-09-22T12:00:00.000Z'),
    requestImpl: async (request) => {
      calls.push(request);
      if (request.url.endsWith('/oauth/v2/token')) {
        return { ok: true, status: 200, data: { access_token: 'token-inter', expires_in: 3600 } };
      }
      if (request.url.includes('/pix/v2/webhook/')) return { ok: true, status: 204, data: {} };
      if (request.method === 'PUT' && request.url.includes('/pix/v2/cob/')) {
        const txid = request.url.split('/').pop();
        return { ok: true, status: 201, data: {
          txid, status: 'ATIVA', pixCopiaECola: '000201PIX-INTER',
          location: 'https://pix.example/qr/1',
          calendario: { criacao: '2026-09-22T09:00:00-03:00', expiracao: 3600 },
        } };
      }
      if (request.method === 'GET' && request.url.includes('/pix/v2/cob/')) {
        return { ok: true, status: 200, data: {
          status: 'CONCLUIDA', valor: { original: '650.00' },
          pix: [{ endToEndId: 'E123', txid: request.url.split('/').pop(), valor: '650.00', horario: '2026-09-22T12:10:00Z' }],
        } };
      }
      throw new Error(`Requisição inesperada: ${request.method} ${request.url}`);
    },
  });
  return { provider, calls };
}

test('Inter cria PIX individual com txid idempotente, mTLS, OAuth e webhook', async () => {
  const { provider, calls } = makeProvider();
  const charge = await provider.createCharge({
    amount: '650.00', due_date: '2026-09-22', public_id: 'COB-RENTAL-2026-000001',
    description: 'Locação semanal',
    client: { name: 'Jefferson', cpf: '175.289.517-73' },
  });

  assert.equal(charge.status, 'waiting_payment');
  assert.equal(charge.pix_code, '000201PIX-INTER');
  assert.match(charge.external_id, /^[A-F0-9]{32}$/);
  assert.equal(charge.provider_metadata.receiver_name, 'Rental Log Service');

  assert.equal(calls[0].url, 'https://cdpj.partners.bancointer.com.br/oauth/v2/token');
  assert.match(calls[0].body, /grant_type=client_credentials/);
  assert.match(calls[0].body, /cob\.write/);
  assert.match(String(calls[0].tls.cert), /BEGIN CERTIFICATE/);
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /\/pix\/v2\/webhook\/45427279000122$/);
  assert.deepEqual(JSON.parse(calls[1].body), { webhookUrl: 'https://locacore.example/webhooks/payment/inter' });

  const createCall = calls[2];
  const payload = JSON.parse(createCall.body);
  assert.equal(createCall.headers['x-conta-corrente'], '12345678');
  assert.equal(payload.valor.original, '650.00');
  assert.equal(payload.valor.modalidadeAlteracao, 0);
  assert.equal(payload.devedor.cpf, '17528951773');
  assert.equal(payload.chave, '45427279000122');
});

test('Inter só confirma depois de consultar a cobrança no banco e conferir o valor', async () => {
  const { provider } = makeProvider();
  const charge = await provider.createCharge({
    amount: 650, due_date: '2026-09-22', public_id: 'COB-RENTAL-2026-000002',
    client: { name: 'Jefferson', cpf: '17528951773' },
  });
  const webhook = provider.parseWebhook({ pix: [{ endToEndId: 'E123', txid: charge.external_id, valor: '650.00' }] });
  const result = await provider.verifyPayment({ charge, webhook });
  assert.equal(webhook.status, 'paid');
  assert.equal(result.verified, true);
  assert.equal(result.paid, true);
  assert.equal(result.paid_amount, 650);
  assert.equal(result.transaction_nsu, 'E123');
});

test('Inter separa webhook em lote e falha fechado sem credenciais', async () => {
  const { provider } = makeProvider();
  const parts = provider.splitWebhook({ pix: [
    { txid: 'A', endToEndId: 'E1', valor: '1.00' },
    { txid: 'B', endToEndId: 'E2', valor: '2.00' },
  ] });
  assert.equal(parts.length, 2);
  assert.equal(provider.parseWebhook(parts[1]).charge_external_id, 'B');

  const missing = interProvider({
    settings: { payment_config: { pix_key: '45427279000122' } },
    secretFn: () => null,
    requestImpl: async () => { throw new Error('não deveria chamar'); },
  });
  await assert.rejects(() => missing.createCharge({ amount: 1, public_id: 'X' }), (err) => err.code === 'NO_CREDENTIALS');
});
