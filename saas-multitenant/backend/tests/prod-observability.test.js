'use strict';
// =============================================================================
// C4 — Observabilidade e paginação: listRentalsPaged, health.ready, alert cooldown.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, rentalModel, health, alertService;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT, brand TEXT, model TEXT );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE, daily_rate NUMERIC(15,2) DEFAULT 0, days INT DEFAULT 1, extras_amount NUMERIC(15,2) DEFAULT 0, discount_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0, pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE system_heartbeats ( service TEXT PRIMARY KEY, last_beat TIMESTAMPTZ NOT NULL DEFAULT NOW(), meta JSONB DEFAULT '{}' );
    CREATE TABLE message_outbox ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, status TEXT );
    CREATE TABLE alert_log ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID, kind TEXT NOT NULL, severity TEXT DEFAULT 'warning', message TEXT, count INT DEFAULT 1, first_at TIMESTAMPTZ DEFAULT NOW(), last_at TIMESTAMPTZ DEFAULT NOW(), last_sent_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  rentalModel = require('../models/rentalModels');
  health = require('../services/health');
  alertService = require('../services/alertService');

  const T = 't1';
  const cli = (await pool.query(`INSERT INTO clients (tenant_id, name) VALUES ($1,'Maria') RETURNING *`, [T])).rows[0];
  const veh = (await pool.query(`INSERT INTO vehicles (tenant_id, plate, brand, model) VALUES ($1,'AAA1A11','Fiat','Argo') RETURNING *`, [T])).rows[0];
  for (let i = 1; i <= 7; i++) {
    await pool.query(`INSERT INTO rentals (tenant_id, rental_number, client_id, vehicle_id, status, start_date, daily_rate) VALUES ($1,$2,$3,$4,'reservado',$5,100)`,
      [T, `LOC-${String(i).padStart(6, '0')}`, cli.id, veh.id, `2027-0${(i % 9) + 1}-01`]);
  }
});

test('paginação: listRentalsPaged devolve total e respeita limit/offset', async () => {
  const p1 = await rentalModel.listRentalsPaged('t1', {}, { limit: 3, offset: 0 });
  assert.equal(p1.total, 7);
  assert.equal(p1.rows.length, 3);
  const p2 = await rentalModel.listRentalsPaged('t1', {}, { limit: 3, offset: 6 });
  assert.equal(p2.rows.length, 1, 'última página');
  // isolamento por tenant
  const other = await rentalModel.listRentalsPaged('outro', {}, { limit: 10, offset: 0 });
  assert.equal(other.total, 0);
});

test('paginação: filtro por período (date_from/date_to) e join de cliente', async () => {
  const r = await rentalModel.listRentalsPaged('t1', { date_from: '2027-05-01', date_to: '2027-12-31' }, { limit: 50, offset: 0 });
  assert.ok(r.total >= 1);
  assert.ok(r.rows.every((x) => x.client_name === 'Maria'));
});

test('health.ready: ok quando o banco responde; heartbeat fresco x ausente', async () => {
  await pool.query(`INSERT INTO system_heartbeats (service, last_beat) VALUES ('worker', NOW())`);
  const r = await health.ready();
  assert.equal(r.ok, true, 'db ok → ready');
  assert.equal(r.checks.worker.ok, true, 'worker heartbeat fresco');
  assert.equal(r.checks.scheduler.ok, false, 'scheduler sem heartbeat');
  assert.equal(r.checks.outbox.ok, true);
});

test('alertas: cooldown evita reenvio; contagem agrega', async () => {
  const a1 = await alertService.raiseAlert('worker_down', { message: 'parou', tenant_id: null, cooldownMinutes: 30 });
  assert.equal(a1.notified, true, 'primeiro dispara');
  const a2 = await alertService.raiseAlert('worker_down', { message: 'parou de novo', tenant_id: null, cooldownMinutes: 30 });
  assert.equal(a2.notified, false, 'dentro do cooldown não reenvia');
  const row = (await pool.query(`SELECT count FROM alert_log WHERE kind='worker_down'`)).rows[0];
  assert.equal(Number(row.count), 2, 'agrega ocorrências');
  await alertService.resolveAlert('worker_down', null);
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM alert_log WHERE kind='worker_down' AND resolved_at IS NULL`)).rows[0].n, 0);
});
