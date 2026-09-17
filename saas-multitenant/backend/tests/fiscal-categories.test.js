'use strict';

// §12/§51: cada natureza de cobrança tem tratamento fiscal próprio. Só a locação
// pura recebe o código transitório 99.01.01 + ISS não incidente; serviço/multa/juros/caução NÃO herdam
// a tributação da locação. Seed idempotente que não sobrescreve edição do admin.

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let M;

before(() => {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.text, impure: true, implementation: () => require('node:crypto').randomUUID() });
  db.public.none(`
    CREATE TABLE fiscal_category_mappings (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT, category_key TEXT, label TEXT,
      national_tax_code TEXT, municipal_service_code TEXT, nbs_code TEXT,
      cst_ibs_cbs TEXT, tax_classification TEXT, iss_treatment TEXT,
      config JSONB DEFAULT '{}', active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_fiscal_category_mapping UNIQUE (tenant_id, category_key)
    );
  `);
  const pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  M = require('../models/automationModels');
});

test('seed cria a locação com 99.01.01 e ISS não incidente, e naturezas separadas', async () => {
  const rows = await M.ensureDefaultFiscalCategories('t1');
  const byKey = Object.fromEntries(rows.map((r) => [r.category_key, r]));
  assert.equal(rows.length, 8);
  assert.equal(byKey.locacao.national_tax_code, '99.01.01');
  assert.equal(byKey.locacao.iss_treatment, 'nao_incide');
  // Serviço/multa/juros NÃO herdam o código nacional da locação.
  assert.equal(byKey.multa.national_tax_code, null);
  assert.equal(byKey.juros.national_tax_code, null);
  assert.equal(byKey.caucao.iss_treatment, 'nao_tributavel');
  assert.ok(['multa', 'juros', 'caucao', 'manutencao', 'avaria', 'combustivel', 'servico_adicional'].every((k) => byKey[k]));
});

test('seed é idempotente e não sobrescreve edição do administrador', async () => {
  await M.ensureDefaultFiscalCategories('t2');
  // Admin ajusta a alíquota/código da locação.
  await M.upsertFiscalCategoryMapping('t2', { category_key: 'locacao', label: 'Locação (custom)', national_tax_code: '01.02.03', iss_treatment: 'incide' });
  const again = await M.ensureDefaultFiscalCategories('t2');
  assert.equal(again.length, 8, 'não duplica');
  const locacao = again.find((r) => r.category_key === 'locacao');
  assert.equal(locacao.national_tax_code, '01.02.03', 'preserva a edição do admin');
  assert.equal(locacao.label, 'Locação (custom)');
});
