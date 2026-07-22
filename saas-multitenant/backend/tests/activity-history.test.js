'use strict';
// =============================================================================
// HISTÓRICO REGISTRADO PELO BACKEND (spec §11) — comprova que os helpers de log
// (logCreate/logActivity) persistem no schema REAL de activity_logs, mapeando
// entity_type→entity, description→details.message e metadata→details. pg-mem.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let activityLog, pool;
const T = randomUUID();
const U = randomUUID();

before(async () => {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid', returns: DataType.uuid, impure: true,
    implementation: () => randomUUID(),
  });
  db.public.none(`
    CREATE TABLE activity_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL, user_id UUID, entity VARCHAR(60), entity_id UUID,
      entity_name TEXT, action VARCHAR(60), details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const pg = db.adapters.createPg();
  pool = new pg.Pool();

  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId);
  stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  activityLog = require('../services/activityLogService');
});

const details = (row) => (typeof row.details === 'string' ? JSON.parse(row.details) : row.details);

test('logCreate (cliente) persiste em activity_logs com mapeamento correto', async () => {
  const eid = randomUUID();
  await activityLog.logCreate(T, U, 'client', eid, 'Cliente cadastrado: Fulano', { cpf: '123' });
  const { rows } = await pool.query('SELECT * FROM activity_logs WHERE tenant_id=$1 AND entity_id=$2', [T, eid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, 'client');
  assert.equal(rows[0].action, 'create');
  assert.equal(details(rows[0]).message, 'Cliente cadastrado: Fulano');
  assert.equal(details(rows[0]).new_data.cpf, '123');
});

test('logActivity (recebimento) registra evento financeiro', async () => {
  const pid = randomUUID();
  await activityLog.logActivity({
    tenant_id: T, user_id: U, action: 'create', entity_type: 'payment',
    entity_id: pid, description: 'Recebimento R$ 100', metadata: { method: 'pix' },
  });
  const { rows } = await pool.query("SELECT * FROM activity_logs WHERE entity='payment' AND entity_id=$1", [pid]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'create');
  assert.equal(details(rows[0]).message, 'Recebimento R$ 100');
  assert.equal(details(rows[0]).method, 'pix');
});

test('logUpdate registra mudanças (changes) entre estado antigo e novo', async () => {
  const eid = randomUUID();
  await activityLog.logUpdate(T, U, 'client', eid, 'Cliente atualizado',
    { name: 'Antigo', status: 'ativo' }, { name: 'Novo', status: 'ativo' });
  const { rows } = await pool.query('SELECT * FROM activity_logs WHERE entity_id=$1 AND action=$2', [eid, 'update']);
  assert.equal(rows.length, 1);
  const d = details(rows[0]);
  assert.equal(d.changes.name.from, 'Antigo');
  assert.equal(d.changes.name.to, 'Novo');
  assert.equal(d.changes.status, undefined); // status não mudou → não entra em changes
});
