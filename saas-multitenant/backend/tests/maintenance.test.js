'use strict';
// =============================================================================
// C4 — Manutenções (§27): CRUD, próximas/vencidas e a regra de elegibilidade
// (veículo em manutenção NÃO pode ser locado).
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, vehicleModel, rentalService, maint;
const T = 't1';
let cli, veh;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT, category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) DEFAULT 0, odometer INT DEFAULT 0, status TEXT DEFAULT 'disponivel', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE, daily_rate NUMERIC(15,2) DEFAULT 0, days INT DEFAULT 1, extras_amount NUMERIC(15,2) DEFAULT 0, discount_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0, pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE vehicle_maintenances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, vehicle_id UUID NOT NULL, type TEXT, status TEXT DEFAULT 'agendada', scheduled_date DATE, done_date DATE, odometer_scheduled INT, odometer_done INT, cost NUMERIC(15,2) DEFAULT 0, supplier TEXT, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  vehicleModel = require('../models/vehicleModels');
  maint = require('../models/vehicleMaintenanceModels');
  const { createTxRunner } = require('../services/tx');
  rentalService = require('../services/rentalService').factory(createTxRunner(pool));

  cli = (await pool.query(`INSERT INTO clients (tenant_id, name) VALUES ($1,'Maria') RETURNING *`, [T])).rows[0];
  veh = await vehicleModel.createVehicle({ tenant_id: T, plate: 'AAA1A11', brand: 'Fiat', model: 'Argo', daily_rate: 100, status: 'disponivel' });
});

test('manutenção: CRUD + próximas/vencidas', async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
  const m = await maint.create({ tenant_id: T, vehicle_id: veh.id, type: 'revisão', status: 'agendada', scheduled_date: tomorrow, cost: 250 });
  assert.equal(m.status, 'agendada');
  assert.equal(Number(m.cost), 250);
  const list = await maint.list(T, {});
  assert.equal(list.length, 1);
  assert.equal(list[0].vehicle_plate, 'AAA1A11');
  const up = await maint.upcomingOrOverdue(T, 7);
  assert.equal(up.length, 1, 'agendada dentro de 7 dias');
});

test('elegibilidade: veículo em manutenção NÃO pode ser locado (409)', async () => {
  await vehicleModel.setVehicleStatus(veh.id, 'manutencao', T);
  await assert.rejects(
    () => rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2027-03-01', end_date: '2027-03-05', daily_rate: 100 }),
    (e) => { assert.equal(e.statusCode, 409); assert.match(e.message, /manutencao/); return true; }
  );
});

test('elegibilidade: concluída a manutenção e liberado o veículo, a locação é criada', async () => {
  await vehicleModel.setVehicleStatus(veh.id, 'disponivel', T);
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2027-03-01', end_date: '2027-03-05', daily_rate: 100 });
  assert.ok(r.id);
  assert.equal(r.status, 'reservado');
});
