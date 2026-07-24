'use strict';
// =============================================================================
// LOCACORE (Frota + Locações) — isolamento multi-tenant (§5) + ciclo de vida da
// locação + dinheiro decimal (§8.5) + vínculo financeiro (rental_id). Exercita os
// MODELS REAIS contra um Postgres em memória (pg-mem). Sem banco externo.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let vehicleModels, rentalModels, billingModels;
const A = 'tenant-A';
const B = 'tenant-B';
let cliA, cliB, vehA, vehB, rentA, rentB;

// Extrai a data calendário (YYYY-MM-DD) seja o driver devolvendo string ou Date.
// (pg-mem devolve Date; node-postgres em produção devolve string/ISO.)
const ymd = (v) => (v == null ? null : (typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10)));

before(async () => {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid', returns: DataType.uuid, impure: true,
    implementation: () => randomUUID(),
  });

  db.public.none(`
    CREATE TABLE users   ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL, name TEXT, cpf TEXT, phone TEXT
    );
    CREATE TABLE service_types ( id INT PRIMARY KEY, code TEXT, label TEXT );
    CREATE TABLE fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, fine_number TEXT, plate TEXT );
    CREATE TABLE vehicles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT,
      category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT,
      daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, odometer INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'disponivel', notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE rentals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID,
      status TEXT NOT NULL DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE,
      daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, days INT NOT NULL DEFAULT 1,
      extras_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, deposit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB,
      notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE service_billings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL, client_id UUID, company_id UUID, fine_id UUID, rental_id UUID,
      service_type_id INT, description TEXT,
      original_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount NUMERIC(15,2) NOT NULL DEFAULT 0,
      surcharge NUMERIC(15,2) NOT NULL DEFAULT 0, final_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0, installments INT NOT NULL DEFAULT 1,
      due_date DATE, payment_method TEXT, financial_status TEXT NOT NULL DEFAULT 'faturado',
      notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const pg = db.adapters.createPg();
  const pool = new pg.Pool();

  // Injeta o pool pg-mem no lugar de config/db ANTES de carregar os models.
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId);
  stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  vehicleModels = require('../models/vehicleModels');
  rentalModels = require('../models/rentalModels');
  billingModels = require('../models/serviceBillingModels');

  // Seed: 1 cliente + 1 veículo por tenant.
  cliA = (await pool.query(`INSERT INTO clients (tenant_id, name, cpf) VALUES ($1,'Cliente A','11111111111') RETURNING *`, [A])).rows[0];
  cliB = (await pool.query(`INSERT INTO clients (tenant_id, name, cpf) VALUES ($1,'Cliente B','22222222222') RETURNING *`, [B])).rows[0];
  vehA = await vehicleModels.createVehicle({ tenant_id: A, plate: 'AAA1A11', brand: 'Fiat', model: 'Argo', daily_rate: 100, status: 'disponivel' });
  vehB = await vehicleModels.createVehicle({ tenant_id: B, plate: 'BBB2B22', brand: 'VW', model: 'Gol', daily_rate: 90, status: 'disponivel' });
});

// ─────────────────────────── FROTA (vehicles) ───────────────────────────
test('frota: listar retorna somente veículos do próprio tenant', async () => {
  const listA = await vehicleModels.getAllVehicles(A);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].id, vehA.id);
});

test('frota: ler por ID de outro tenant → não encontra', async () => {
  assert.equal(await vehicleModels.getVehicleById(vehB.id, A), undefined);
  assert.ok(await vehicleModels.getVehicleById(vehA.id, A));
});

test('frota: buscar por placa não vaza entre tenants', async () => {
  assert.equal(await vehicleModels.getVehicleByPlate('BBB2B22', A), undefined);
  assert.ok(await vehicleModels.getVehicleByPlate('AAA1A11', A));
});

test('frota: atualizar veículo de outro tenant → não altera', async () => {
  const upd = await vehicleModels.updateVehicle(vehB.id, { brand: 'INVASOR' }, A);
  assert.equal(upd, undefined);
  const still = await vehicleModels.getVehicleById(vehB.id, B);
  assert.equal(still.brand, 'VW');
});

test('frota: excluir veículo de outro tenant → não remove', async () => {
  const del = await vehicleModels.deleteVehicle(vehB.id, A);
  assert.equal(del, undefined);
  assert.ok(await vehicleModels.getVehicleById(vehB.id, B));
});

test('frota: stats isoladas por tenant', async () => {
  const s = await vehicleModels.getFleetStats(A);
  assert.equal(Number(s.total), 1);
  assert.equal(Number(s.disponivel), 1);
});

// ─────────────────────────── LOCAÇÕES (rentals) ───────────────────────────
test('locação: criar calcula diárias e total, e numera LOC-000001', async () => {
  rentA = await rentalModels.createRental({
    tenant_id: A, client_id: cliA.id, vehicle_id: vehA.id,
    start_date: '2026-07-01', end_date: '2026-07-06', daily_rate: 100, // 5 diárias
    extras_amount: 50, discount_amount: 30, deposit_amount: 200,
  });
  assert.equal(rentA.days, 5);
  // total = 100*5 + 50 - 30 = 520
  assert.equal(Number(rentA.total_amount), 520);
  assert.equal(rentA.rental_number, 'LOC-000001');
  assert.equal(rentA.status, 'reservado');

  rentB = await rentalModels.createRental({
    tenant_id: B, client_id: cliB.id, vehicle_id: vehB.id,
    start_date: '2026-07-01', end_date: '2026-07-03', daily_rate: 90,
  });
  // total = 90*2 = 180 ; numeração é POR TENANT → também LOC-000001
  assert.equal(Number(rentB.total_amount), 180);
  assert.equal(rentB.rental_number, 'LOC-000001');
});

test('locação: dinheiro é decimal (2 casas, sem artefato de float)', async () => {
  const r = await rentalModels.createRental({
    tenant_id: A, client_id: cliA.id, vehicle_id: vehA.id,
    days: 3, daily_rate: 0.1, extras_amount: 0.2, // 0.1*3 + 0.2 = 0.5 exato
  });
  assert.equal(Number(r.total_amount), 0.5);
  assert.equal(rentalModels.computeTotal({ daily_rate: 0.1, days: 3, extras_amount: 0.2, discount_amount: 0 }), '0.50');
});

test('locação: listar (com JOIN de cliente/veículo) só do próprio tenant', async () => {
  const listA = await rentalModels.getAllRentals(A);
  assert.ok(listA.length >= 1);
  assert.ok(listA.every((x) => x.tenant_id === A));
  const one = listA.find((x) => x.id === rentA.id);
  assert.equal(one.client_name, 'Cliente A');
  assert.equal(one.vehicle_plate, 'AAA1A11');
});

test('locação: ler/alterar/excluir de outro tenant é bloqueado', async () => {
  assert.equal(await rentalModels.getRentalById(rentB.id, A), undefined);
  assert.equal(await rentalModels.setRentalStatus(rentB.id, 'cancelado', A), undefined);
  const stillB = await rentalModels.getRentalById(rentB.id, B);
  assert.equal(stillB.status, 'reservado');
  assert.equal(await rentalModels.deleteRental(rentB.id, A), undefined);
  assert.ok(await rentalModels.getRentalById(rentB.id, B));
});

test('locação: devolução finaliza e registra data/hodômetro', async () => {
  const closed = await rentalModels.closeRental(rentA.id, { return_date: '2026-07-06', return_odometer: 12345 }, A);
  assert.equal(closed.status, 'finalizado');
  assert.equal(ymd(closed.return_date), '2026-07-06');
  assert.equal(Number(closed.return_odometer), 12345);
});

test('locação: stats agregam valores em aberto por tenant', async () => {
  const s = await rentalModels.getRentalStats(A);
  assert.ok(Number(s.total) >= 2);
  assert.equal(Number(s.finalizado), 1);         // rentA finalizada
  // rentA (520) finalizada não conta em "em aberto"; o r de 0.50 (reservado) conta.
  assert.equal(Number(s.valor_em_aberto), 0.5);
});

// ─────────────────────────── VÍNCULO FINANCEIRO ───────────────────────────
test('financeiro: faturamento vincula rental_id e não vaza entre tenants', async () => {
  const b = await billingModels.createBilling({
    tenant_id: A, client_id: cliA.id, rental_id: rentA.id,
    description: 'Locação LOC-000001', original_amount: 520, discount: 0, surcharge: 0,
    final_amount: 520, financial_status: 'faturado',
  });
  assert.equal(b.rental_id, rentA.id);

  const listA = await billingModels.getBillingsByRental(rentA.id, A);
  assert.equal(listA.length, 1);
  assert.equal(Number(listA[0].final_amount), 520);

  // Outro tenant não enxerga o faturamento da locação de A.
  const listB = await billingModels.getBillingsByRental(rentA.id, B);
  assert.equal(listB.length, 0);

  const summary = await billingModels.getRentalSummary(rentA.id, A);
  assert.equal(Number(summary.total_billed), 520);
});
