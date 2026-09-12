'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { newDb, DataType } = require('pg-mem');

const { resolveWeeklyAmount } = require('../services/automation/billingAmount');
const { zonedParts, weekBoundsInZone, isScheduledNow } = require('../services/automation/timezone');
const { infinitePayProvider, manualPixProvider } = require('../services/automation/providers/payment');
const { nationalNfseProvider, validateConfig } = require('../services/automation/providers/fiscal');
const { selectForMode } = require('../services/automation/billingCycleService');
const { evolutionProvider, normalizeWhatsAppNumber } = require('../services/automation/providers/whatsapp');
const secretStore = require('../services/automation/secretStore');
const automationModels = require('../models/automationModels');

test('valor semanal: usa valor explícito, diária x 7 e nunca presume o total', () => {
  assert.deepEqual(resolveWeeklyAmount({ weekly_rate: 700, daily_rate: 200, total_amount: 9000 }), {
    ok: true, amount: '700.00', source: 'weekly_rate', days: 7,
  });
  assert.equal(resolveWeeklyAmount({ daily_rate: 120, total_amount: 9000 }).amount, '840.00');
  assert.equal(resolveWeeklyAmount({ total_amount: 9000 }).code, 'NO_SAFE_AMOUNT');
  assert.equal(resolveWeeklyAmount({ total_amount: 9000, billing_value_source: 'total' }).amount, '9000.00');
});

test('fuso: agenda e semana respeitam America/Sao_Paulo inclusive horário histórico de verão', () => {
  const mondayNoonUtc = new Date('2026-08-17T12:00:00.000Z');
  const local = zonedParts(mondayNoonUtc, 'America/Sao_Paulo');
  assert.equal(local.hour, 9);
  assert.equal(local.weekday, 1);
  assert.equal(isScheduledNow(mondayNoonUtc, { weekday: 1, hour: 9, timeZone: 'America/Sao_Paulo' }), true);
  assert.deepEqual(weekBoundsInZone(mondayNoonUtc, 'America/Sao_Paulo'), {
    start: '2026-08-17', end: '2026-08-23', local,
  });

  const summer = zonedParts(new Date('2018-01-15T11:00:00.000Z'), 'America/Sao_Paulo');
  assert.equal(summer.hour, 9, 'em janeiro de 2018 São Paulo estava em UTC-2');
});

test('rollout: piloto, escalonado, global e off selecionam somente o escopo autorizado', () => {
  const rentals = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(selectForMode(rentals, { automation_mode: 'pilot', pilot_rental_ids: ['b'] }), [{ id: 'b' }]);
  assert.deepEqual(selectForMode(rentals, { automation_mode: 'staged', rollout_limit: 2 }), rentals.slice(0, 2));
  assert.deepEqual(selectForMode(rentals, { automation_mode: 'staged', rollout_limit: 3, pilot_rental_ids: ['c', 'a'] }), [{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(selectForMode(rentals, { automation_mode: 'global' }), rentals);
  assert.deepEqual(selectForMode(rentals, { automation_mode: 'off' }), []);
});

test('PIX direto cria cobrança auditável e exige confirmação manual', async () => {
  const provider = manualPixProvider({ settings: { payment_config: {
    pix_key: '45427279000122', pix_receiver_name: 'Rental Log Service',
  } } });
  const charge = await provider.createCharge({ amount: '650.00', due_date: '2026-09-04', public_id: 'COB-T-2026-000001' });
  assert.equal(charge.external_id, 'manual:COB-T-2026-000001');
  assert.equal(charge.pix_code, '45427279000122');
  assert.equal(charge.status, 'waiting_payment');
  assert.equal(charge.provider_metadata.confirmation_mode, 'manual');
  await assert.rejects(() => provider.verifyPayment(), (err) => err.code === 'MANUAL_CONFIRMATION_REQUIRED');
});

test('Evolution em modo WhatsApp Web envia o texto renderizado somente após aceite explícito', async () => {
  const calls = [];
  const provider = evolutionProvider({
    settings: { whatsapp_config: {
      api_url: 'https://evolution.example', instance: 'rental-log',
      provider_mode: 'baileys', unofficial_acknowledged: true,
    } },
    secretFn: (_scope, name) => name === 'API_KEY' ? 'test-key' : null,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ key: { id: 'msg-1' } }) };
    },
  });
  await provider.sendTemplateMessage({
    to: '21 98326-2057', provider_template_id: 'ignorar-no-modo-texto',
    body: 'Cobrança R$ 650 — PIX 45427279000122',
  });
  assert.equal(calls[0].url, 'https://evolution.example/message/sendText/rental-log');
  assert.deepEqual(calls[0].body, { number: '5521983262057', text: 'Cobrança R$ 650 — PIX 45427279000122' });

  const blocked = evolutionProvider({
    settings: { whatsapp_config: { api_url: 'https://evolution.example', instance: 'rental-log', provider_mode: 'baileys' } },
    secretFn: () => 'test-key', fetchImpl: async () => { throw new Error('não deveria chamar'); },
  });
  await assert.rejects(() => blocked.sendTemplateMessage({ to: '5521983262057', body: 'teste' }), /reconhecimento explícito/);
});

test('WhatsApp normaliza telefone brasileiro para o formato internacional sem duplicar o DDI', () => {
  assert.equal(normalizeWhatsAppNumber('(21) 98884-1509'), '5521988841509');
  assert.equal(normalizeWhatsAppNumber('+55 21 98884-1509'), '5521988841509');
  assert.equal(normalizeWhatsAppNumber('021988841509'), '5521988841509');
});

test('identificador da cobrança é único também entre tenants', () => {
  const a = automationModels.formatChargePublicId('11111111-1111-4111-8111-111111111111', 2026, 1);
  const b = automationModels.formatChargePublicId('22222222-2222-4222-8222-222222222222', 2026, 1);
  assert.notEqual(a, b);
  assert.match(a, /^COB-11111111111141118111111111111111-2026-000001$/);
});

test('InfinitePay: cria link em centavos com order_nsu e webhook público', async () => {
  const calls = [];
  const provider = infinitePayProvider({
    settings: { payment_config: { handle: 'leandro', webhook_url: 'https://locacore.example/webhooks/infinitepay' } },
    secretFn: () => null,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ url: 'https://checkout.infinitepay.io/leandro/inv-123', invoice_slug: 'inv-123' }) };
    },
  });
  const result = await provider.createCharge({ amount: '700.10', description: 'Semana 1', public_id: 'LOC-2026-000001', client: { name: 'João' } });
  assert.equal(calls[0].url, 'https://api.checkout.infinitepay.io/links');
  assert.equal(calls[0].body.items[0].price, 70010);
  assert.equal(calls[0].body.order_nsu, 'LOC-2026-000001');
  assert.equal(calls[0].body.webhook_url, 'https://locacore.example/webhooks/infinitepay');
  assert.equal(result.provider_metadata.invoice_slug, 'inv-123');
});

test('InfinitePay: pagamento só é confirmado por payment_check e conserva centavos', async () => {
  let request;
  const provider = infinitePayProvider({
    settings: { payment_config: { handle: 'leandro' } }, secretFn: () => null,
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ success: true, paid: true, amount: 70010, paid_amount: 70010 }) };
    },
  });
  const result = await provider.verifyPayment({
    charge: { public_id: 'LOC-2026-000001', provider_metadata: { invoice_slug: 'inv-123' } },
    webhook: { transaction_nsu: 'txn-1' },
  });
  assert.equal(request.url, 'https://api.checkout.infinitepay.io/payment_check');
  assert.deepEqual(request.body, { handle: 'leandro', order_nsu: 'LOC-2026-000001', transaction_nsu: 'txn-1', slug: 'inv-123' });
  assert.equal(result.verified, true);
  assert.equal(result.paid, true);
  assert.equal(result.amount, 700.1);
});

test('NFS-e nacional permanece fail-closed sem certificado A1', async () => {
  const settings = { fiscal_provider: 'nfse_nacional', fiscal_document_type: 'nfse', fiscal_config: {
    municipio: '3550308', cnpj: '12345678000190', regime_tributario: 'simples', inscricao_municipal: '123',
    codigo_servico: 'x', aliquota: 0, razao_social: 'Locadora', uf: 'SP', cep: '01001000',
    codigo_tributacao_nacional: '99.04.01', cst_ibs_cbs: '000', classificacao_tributaria: 'x',
    tratamento_iss: 'nao_incide', api_url: 'https://example.test', issue_path: '/nfse',
    dps_series: '00001',
  } };
  assert.equal(validateConfig(settings).ok, true);
  const result = await nationalNfseProvider({ certificate: null }).issueDocument({ ref: 'f-1', amount: 700, document_type: 'nfse', settings });
  assert.equal(result.status, 'pending_configuration');
  assert.equal(result.error_code, 'NO_CERTIFICATE');
});

test('segredos: AES-256-GCM cifra, decifra e detecta adulteração', () => {
  const previous = process.env.AUTOMATION_SECRETS_KEY;
  process.env.AUTOMATION_SECRETS_KEY = 'cycle9-test-key-that-is-not-a-production-secret';
  try {
    const encrypted = secretStore.encrypt('token-sensível');
    assert.notEqual(encrypted.ciphertext.toString('utf8'), 'token-sensível');
    assert.equal(secretStore.decrypt(encrypted), 'token-sensível');
    const tampered = { ...encrypted, auth_tag: Buffer.from(encrypted.auth_tag) };
    tampered.auth_tag[0] ^= 1;
    assert.throws(() => secretStore.decrypt(tampered));
  } finally {
    if (previous === undefined) delete process.env.AUTOMATION_SECRETS_KEY;
    else process.env.AUTOMATION_SECRETS_KEY = previous;
  }
});

test('webhook com falha pode ser retomado uma vez; processado continua deduplicado', async () => {
  const db = newDb();
  db.public.none(`
    CREATE TABLE webhook_events (
      id SERIAL PRIMARY KEY, tenant_id TEXT, provider TEXT NOT NULL, kind TEXT,
      external_event_id TEXT NOT NULL, payload_hash TEXT, correlation_id TEXT,
      received_at TIMESTAMPTZ DEFAULT NOW(), processed_at TIMESTAMPTZ,
      processing_status TEXT NOT NULL DEFAULT 'received', error_message TEXT,
      UNIQUE(provider, external_event_id)
    )
  `);
  const pool = new (db.adapters.createPg().Pool)();
  const event = { tenant_id: 't1', provider: 'infinitepay', kind: 'payment', external_event_id: 'evt-1', payload_hash: 'abc' };
  assert.equal(await automationModels.registerWebhookEvent(event, pool), true);
  await automationModels.markWebhookProcessed('infinitepay', 'evt-1', { status: 'failed', error_message: 'timeout' }, pool);
  assert.equal(await automationModels.registerWebhookEvent(event, pool), true);
  assert.equal(await automationModels.registerWebhookEvent(event, pool), false, 'segunda réplica concorrente não retoma');
  await automationModels.markWebhookProcessed('infinitepay', 'evt-1', { status: 'processed' }, pool);
  assert.equal(await automationModels.registerWebhookEvent(event, pool), false);
});

test('migration do ciclo 9 aplica sobre o schema anterior sem reescrever dados', async () => {
  const db = newDb();
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  });
  db.public.none(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    CREATE TABLE users (id UUID PRIMARY KEY);
    CREATE TABLE clients (id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), name TEXT);
    CREATE TABLE vehicles (id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), plate TEXT);
    CREATE TABLE rentals (id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), client_id UUID REFERENCES clients(id), vehicle_id UUID REFERENCES vehicles(id));
    CREATE TABLE service_billings (id UUID PRIMARY KEY);
    CREATE TABLE payments (id UUID PRIMARY KEY);
    CREATE TABLE automation_settings (
      id UUID PRIMARY KEY, tenant_id UUID UNIQUE REFERENCES tenants(id),
      fiscal_mode VARCHAR(20) NOT NULL DEFAULT 'after_payment',
      CONSTRAINT automation_settings_fiscal_mode_check CHECK (fiscal_mode IN ('after_payment','weekly_batch','manual'))
    );
    CREATE TABLE charges (
      id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), rental_id UUID REFERENCES rentals(id),
      client_id UUID REFERENCES clients(id), billing_id UUID REFERENCES service_billings(id), provider VARCHAR(30),
      status VARCHAR(20) DEFAULT 'pending', CONSTRAINT charges_status_check CHECK (status IN ('pending','paid','expired','canceled'))
    );
    CREATE TABLE message_outbox (
      id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), charge_id UUID REFERENCES charges(id),
      status VARCHAR(20) DEFAULT 'pending', CONSTRAINT message_outbox_status_check CHECK (status IN ('pending','sent','failed','canceled'))
    );
    CREATE TABLE fiscal_documents (
      id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), rental_id UUID REFERENCES rentals(id),
      client_id UUID REFERENCES clients(id), billing_id UUID REFERENCES service_billings(id), payment_id UUID REFERENCES payments(id),
      status VARCHAR(30) DEFAULT 'pending_configuration',
      CONSTRAINT fiscal_documents_status_check CHECK (status IN ('pending_configuration','pending','authorized','failed','canceled'))
    );
    CREATE TABLE webhook_events (
      id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), provider VARCHAR(30), kind VARCHAR(30),
      external_event_id VARCHAR(200), received_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(provider, external_event_id)
    );
    INSERT INTO tenants (id) VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO automation_settings (id,tenant_id) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
  `);

  const before = (await db.public.many('SELECT tenant_id,fiscal_mode FROM automation_settings'))[0];
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle9.sql'), 'utf8');
  db.public.none(sql);
  const after = (await db.public.many('SELECT tenant_id,fiscal_mode,automation_mode FROM automation_settings'))[0];
  assert.equal(after.tenant_id, before.tenant_id);
  assert.equal(after.fiscal_mode, 'after_payment');
  assert.equal(after.automation_mode, 'off');
  db.public.none(`INSERT INTO charges (id,tenant_id,status,public_id) VALUES ('00000000-0000-4000-8000-000000000003','${after.tenant_id}','needs_attention','LOC-1')`);
  assert.equal(db.public.one("SELECT status FROM charges WHERE public_id='LOC-1'").status, 'needs_attention');
  assert.equal(db.public.one("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='tenant_integration_secrets'").n, 1);
  assert.equal(db.public.one("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='automation_audit_log'").n, 1);
});
