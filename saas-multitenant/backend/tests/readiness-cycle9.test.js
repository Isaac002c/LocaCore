'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';
process.env.BASE_URL = 'https://locacore.example';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool;
let dataCounts;
let integrationsReadiness;

const SETTINGS = {
  tenant_id: 'tenant-leandro', automation_mode: 'off', pilot_rental_ids: [], rollout_limit: 1,
  payment_provider: 'infinitepay', payment_config: { handle: 'leandro' },
  whatsapp_enabled: true, whatsapp_provider: 'evolution',
  whatsapp_config: { api_url: 'https://evolution.example', instance: 'leandro', provider_mode: 'cloud' },
  fiscal_enabled: true, fiscal_provider: 'nfse_nacional', fiscal_document_type: 'nfse',
  fiscal_config: {
    municipio: '3550308', cnpj: '12345678000190', regime_tributario: 'simples', inscricao_municipal: '123',
    codigo_servico: 'x', aliquota: 0, razao_social: 'Locadora', uf: 'SP', cep: '01001000',
    codigo_tributacao_nacional: '01.01.01', cst_ibs_cbs: '000', classificacao_tributaria: 'x',
    tratamento_iss: 'nao_incide', api_url: 'https://fiscal.example', issue_path: '/nfse',
    dps_series: '00001',
  },
};

before(async () => {
  const db = newDb();
  db.public.registerFunction({
    name: 'regexp_replace', args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (value) => String(value || '').replace(/[^0-9]/g, ''),
  });
  db.public.registerFunction({
    name: 'nullif', args: [DataType.text, DataType.text], returns: DataType.text,
    implementation: (value, empty) => value === empty ? null : value,
  });
  db.public.registerFunction({
    name: 'trim', args: [DataType.text], returns: DataType.text,
    implementation: (value) => value == null ? null : String(value).trim(),
  });
  db.public.none(`
    CREATE TABLE clients (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, phone TEXT, cpf TEXT);
    CREATE TABLE vehicles (id TEXT PRIMARY KEY, tenant_id TEXT, plate TEXT, ncm TEXT);
    CREATE TABLE rentals (
      id TEXT PRIMARY KEY, tenant_id TEXT, client_id TEXT, vehicle_id TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
      weekly_rate NUMERIC, daily_rate NUMERIC, total_amount NUMERIC, billing_value_source TEXT DEFAULT 'auto'
    );
    CREATE TABLE message_templates (
      id TEXT PRIMARY KEY, tenant_id TEXT, kind TEXT, active BOOLEAN, provider_template_id TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE tenant_integration_secrets (tenant_id TEXT, scope TEXT, secret_name TEXT);
    CREATE TABLE tenant_fiscal_certificates (
      id TEXT, tenant_id TEXT, filename TEXT, mime_type TEXT, size_bytes INTEGER, sha256 TEXT,
      valid_from TIMESTAMPTZ, valid_until TIMESTAMPTZ, subject_name TEXT, serial_number TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE system_heartbeats (service TEXT, last_beat TIMESTAMPTZ, meta JSONB);

    INSERT INTO clients VALUES
      ('c1','tenant-leandro','Completo','+55 11 99999-9999','12345678909'),
      ('c2','tenant-leandro','Pendente',NULL,NULL);
    INSERT INTO vehicles VALUES
      ('v1','tenant-leandro','AAA1A11','87032210'),
      ('v2','tenant-leandro','BBB2B22',NULL);
    INSERT INTO rentals (id,tenant_id,client_id,vehicle_id,status,daily_rate,billing_value_source) VALUES
      ('r1','tenant-leandro','c1','v1','em_andamento',100,'auto'),
      ('r2','tenant-leandro','c2','v2','atrasado',NULL,'auto'),
      ('r3','tenant-leandro','c2','v2','finalizado',NULL,'auto');
    INSERT INTO message_templates VALUES
      ('t1','tenant-leandro','billing',TRUE,'cobranca_locacao',NOW()),
      ('t2','tenant-leandro','reminder',TRUE,'lembrete_cobranca',NOW()),
      ('t3','tenant-leandro','payment_confirmed',TRUE,'pagamento_confirmado',NOW());
    INSERT INTO tenant_integration_secrets VALUES
      ('tenant-leandro','whatsapp:evolution','API_KEY'),
      ('tenant-leandro','whatsapp:evolution','APP_SECRET');
    INSERT INTO tenant_fiscal_certificates
      (id,tenant_id,filename,mime_type,size_bytes,sha256,valid_from,valid_until,subject_name,serial_number)
      VALUES ('cert','tenant-leandro','cert.pfx','application/x-pkcs12',10,'hash','2026-01-01','2030-01-01','Locadora','1');
    INSERT INTO system_heartbeats VALUES ('scheduler',NOW(),'{}');
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  ({ dataCounts, integrationsReadiness } = require('../services/automation/readiness'));
});

test('readiness conta somente locações ativas e não inventa dados ausentes', async () => {
  assert.deepEqual(await dataCounts('tenant-leandro'), {
    active_rentals: 2, rentals_without_value: 1,
    active_clients: 2, clients_without_phone: 1, clients_without_document: 1,
    active_vehicles: 2, vehicles_without_ncm: 1,
  });
});

test('readiness global bloqueia pelos dados faltantes e informa contagens exatas', async () => {
  const result = await integrationsReadiness(SETTINGS, 'leandro', { tenant_id: 'tenant-leandro', mode: 'global' });
  assert.equal(result.activation.allowed, false);
  assert.equal(result.counts.rentals_without_value, 1);
  assert.equal(result.counts.clients_without_phone, 1);
  assert.equal(result.counts.clients_without_document, 1);
  assert.equal(result.counts.vehicles_without_ncm, 1);
  assert.deepEqual(result.activation.blockers.map((item) => item.key).sort(),
    ['client_document', 'client_phone', 'rental_value']);
});

test('readiness do piloto limita a auditoria à única locação selecionada', async () => {
  const result = await integrationsReadiness({ ...SETTINGS, pilot_rental_ids: ['r1'] }, 'leandro', {
    tenant_id: 'tenant-leandro', mode: 'pilot', rental_ids: ['r1'],
  });
  assert.equal(result.counts.active_rentals, 1);
  assert.equal(result.counts.rentals_without_value, 0);
  assert.equal(result.counts.clients_without_phone, 0);
  assert.equal(result.counts.clients_without_document, 0);
  assert.equal(result.counts.vehicles_without_ncm, 0);
  assert.equal(result.activation.allowed, true);
});

test('readiness aceita PIX direto sem InfiniteTag/webhook financeiro e mantém baixa manual', async () => {
  const result = await integrationsReadiness({
    ...SETTINGS,
    payment_provider: 'manual_pix', payments_enabled: false,
    payment_config: { pix_key: '45427279000122', pix_receiver_name: 'Rental Log Service' },
    pilot_rental_ids: ['r1'],
  }, 'leandro', { tenant_id: 'tenant-leandro', mode: 'pilot', rental_ids: ['r1'] });
  assert.equal(result.activation.allowed, true);
  assert.equal(result.checks.find((item) => item.key === 'manual_pix_key').ok, true);
  assert.equal(result.checks.find((item) => item.key === 'payment_webhook').critical, false);
  assert.equal(result.integrations.find((item) => item.key === 'pagamento').nome, 'PIX com confirmacao manual');
});

test('readiness do piloto bloqueia seleção de zero ou mais de uma locação', async () => {
  const none = await integrationsReadiness(SETTINGS, 'leandro', {
    tenant_id: 'tenant-leandro', mode: 'pilot', rental_ids: [],
  });
  assert.equal(none.activation.blockers.some((item) => item.key === 'pilot_selection'), true);
  const two = await integrationsReadiness(SETTINGS, 'leandro', {
    tenant_id: 'tenant-leandro', mode: 'pilot', rental_ids: ['r1', 'r2'],
  });
  assert.equal(two.activation.blockers.some((item) => item.key === 'pilot_selection'), true);
});
