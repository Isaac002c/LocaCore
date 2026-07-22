'use strict';
// =============================================================================
// CAIXA da despachante (áudios Pâmela): o lançamento guarda a PLACA do veículo
// e a listagem do Caixa devolve placa + nome + TELEFONE do cliente vinculado —
// para ela identificar "de qual veículo / de quem" foi cada movimentação.
// Models reais (financialTransactionModels) contra pg-mem.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let txModel, pool;
const T = 'tenant-1';
let cliId;

before(async () => {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid', returns: DataType.uuid, impure: true,
    implementation: () => randomUUID(),
  });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, phone TEXT );
    CREATE TABLE financial_categories ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, type TEXT );
    CREATE TABLE fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, fine_number TEXT, plate TEXT );
    CREATE TABLE users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE financial_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL, type TEXT NOT NULL, category_id UUID, description TEXT,
      amount NUMERIC(15,2) NOT NULL, transaction_date DATE, due_date DATE,
      payment_method TEXT, status TEXT DEFAULT 'pago', client_id UUID, fine_id UUID,
      billing_id UUID, payment_id UUID, origin TEXT DEFAULT 'manual', created_by UUID,
      notes TEXT, plate VARCHAR(10), canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const pg = db.adapters.createPg();
  pool = new pg.Pool();

  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId);
  stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  txModel = require('../models/financialTransactionModels');

  const c = await pool.query("INSERT INTO clients (tenant_id, name, phone) VALUES ($1,'Pâmela Vilas Boas','11999998888') RETURNING id", [T]);
  cliId = c.rows[0].id;
});

test('lançamento no Caixa grava a placa vinculada ao cliente', async () => {
  const tx = await txModel.createTransaction({
    tenant_id: T, type: 'entrada', description: 'Transferência com troca de placa',
    amount: 250, client_id: cliId, plate: 'ABC1D23', payment_method: 'pix', status: 'pago',
  });
  assert.equal(tx.plate, 'ABC1D23');
  assert.equal(tx.client_id, cliId);
});

test('listagem do Caixa retorna placa + nome + telefone do cliente', async () => {
  const { rows } = await txModel.listTransactions(T, {});
  const r = rows.find((x) => x.plate === 'ABC1D23');
  assert.ok(r, 'deve existir o lançamento com placa');
  assert.equal(r.client_name, 'Pâmela Vilas Boas');
  assert.equal(r.client_phone, '11999998888');
  assert.equal(r.description, 'Transferência com troca de placa');
});
