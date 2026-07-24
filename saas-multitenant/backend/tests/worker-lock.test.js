'use strict';
// =============================================================================
// C4 — Lock distribuído (job_locks) e runner multi-tenant (worker/scheduler).
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, lock, runner, M;
const A = 'tenant-A', B = 'tenant-B';

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE job_locks ( name TEXT PRIMARY KEY, owner TEXT NOT NULL, acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL );
    CREATE TABLE system_heartbeats ( service TEXT PRIMARY KEY, last_beat TIMESTAMPTZ NOT NULL DEFAULT NOW(), meta JSONB NOT NULL DEFAULT '{}' );
    CREATE TABLE automation_settings ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL UNIQUE, billing_enabled BOOLEAN DEFAULT FALSE, whatsapp_enabled BOOLEAN DEFAULT TRUE, fiscal_enabled BOOLEAN DEFAULT FALSE, whatsapp_provider TEXT DEFAULT 'null', whatsapp_send_start_hour INT DEFAULT 0, whatsapp_send_end_hour INT DEFAULT 24, cost_per_message NUMERIC(15,4) DEFAULT 0, billing_weekday INT DEFAULT 3, billing_hour INT DEFAULT 9, updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE message_outbox ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id TEXT, rental_id UUID, charge_id UUID, template_kind TEXT, to_number TEXT, body TEXT, payload JSONB DEFAULT '{}', status TEXT DEFAULT 'pending', attempts INT DEFAULT 0, max_attempts INT DEFAULT 5, next_attempt_at TIMESTAMPTZ, provider TEXT, external_id TEXT, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, error TEXT, cost_amount NUMERIC(15,4) DEFAULT 0, idempotency_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_ob UNIQUE (tenant_id, idempotency_key) );
    CREATE TABLE external_costs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, kind TEXT, ref_id UUID, provider TEXT, quantity INT DEFAULT 1, unit_cost NUMERIC(15,4) DEFAULT 0, amount NUMERIC(15,4) DEFAULT 0, currency TEXT DEFAULT 'BRL', cost_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, status TEXT );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  lock = require('../services/lock');
  runner = require('../services/automation/runner');
  M = require('../models/automationModels');

  await pool.query(`INSERT INTO automation_settings (tenant_id, whatsapp_enabled, cost_per_message) VALUES ($1,TRUE,0.05),($2,TRUE,0.05)`, [A, B]);
});

test('lock: só um dono por vez; libera e permite readquirir', async () => {
  const l1 = await lock.acquireLock('job1', { ttlSeconds: 60, owner: 'w1' });
  assert.equal(l1.acquired, true);
  const l2 = await lock.acquireLock('job1', { ttlSeconds: 60, owner: 'w2' });
  assert.equal(l2.acquired, false, 'segundo não adquire enquanto ativo');
  await lock.releaseLock('job1', 'w1');
  const l3 = await lock.acquireLock('job1', { ttlSeconds: 60, owner: 'w2' });
  assert.equal(l3.acquired, true, 'após liberar, outro adquire');
  await lock.releaseLock('job1', 'w2');
});

test('lock: lease expirado pode ser assumido por outra instância', async () => {
  await pool.query(`INSERT INTO job_locks (name, owner, acquired_at, expires_at) VALUES ('stale','dead', NOW(), $1)`, [new Date(Date.now() - 1000).toISOString()]);
  const l = await lock.acquireLock('stale', { ttlSeconds: 60, owner: 'new' });
  assert.equal(l.acquired, true);
  await lock.releaseLock('stale', 'new');
});

test('lock: withLock pula quando já bloqueado', async () => {
  const held = await lock.acquireLock('withl', { ttlSeconds: 60, owner: 'holder' });
  assert.equal(held.acquired, true);
  let ran = false;
  const r = await lock.withLock('withl', 60, async () => { ran = true; return 'x'; });
  assert.equal(r.skipped, 'locked');
  assert.equal(ran, false);
  await lock.releaseLock('withl', 'holder');
});

test('runner: processOutboxAll processa a fila de TODOS os tenants', async () => {
  await M.insertOutbox({ tenant_id: A, template_kind: 'billing', to_number: '+5511', body: 'oi A', idempotency_key: 'a1' });
  await M.insertOutbox({ tenant_id: B, template_kind: 'billing', to_number: '+5511', body: 'oi B', idempotency_key: 'b1' });
  const res = await runner.processOutboxAll({ limit: 50 });
  assert.equal(res.tenants, 2);
  assert.equal(res.sent, 2);
  const sentA = (await pool.query(`SELECT COUNT(*)::int n FROM message_outbox WHERE tenant_id=$1 AND status='sent'`, [A])).rows[0].n;
  assert.equal(sentA, 1);
  // custo registrado por tenant
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM external_costs WHERE tenant_id=$1`, [A])).rows[0].n, 1);
});

test('runner: heartbeat faz upsert do serviço', async () => {
  await runner.heartbeat('worker', { pid: 123 });
  const r1 = await pool.query(`SELECT last_beat FROM system_heartbeats WHERE service='worker'`);
  assert.equal(r1.rows.length, 1);
  await runner.heartbeat('worker', { pid: 123 });
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM system_heartbeats WHERE service='worker'`)).rows[0].n, 1, 'upsert, não duplica');
});
