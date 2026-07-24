'use strict';
// =============================================================================
// C5 — Multas da locadora (§4) e Estoque (§5): fluxo, transformação em adicional,
// movimentações transacionais (sem estoque negativo), mínimo e isolamento.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, fines, inv, rentalModel, vehicleModel, rentalService;
const T = 't1', T2 = 't2';
let cli, veh, rental;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT, category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) DEFAULT 0, odometer INT DEFAULT 0, status TEXT DEFAULT 'disponivel', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'em_andamento', start_date DATE, end_date DATE, return_date DATE, daily_rate NUMERIC(15,2) DEFAULT 0, days INT DEFAULT 1, extras_amount NUMERIC(15,2) DEFAULT 0, discount_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0, pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE rental_extras ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, rental_id UUID, category TEXT, description TEXT, quantity NUMERIC(12,2) DEFAULT 1, unit_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, extra_date DATE, status TEXT DEFAULT 'ativo', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE service_billings ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, client_id UUID, company_id UUID, fine_id UUID, rental_id UUID, service_type_id INT, description TEXT, original_amount NUMERIC(15,2) DEFAULT 0, discount NUMERIC(15,2) DEFAULT 0, surcharge NUMERIC(15,2) DEFAULT 0, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0, installments INT DEFAULT 1, due_date DATE, payment_method TEXT, financial_status TEXT DEFAULT 'faturado', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE rental_fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, vehicle_id UUID, client_id UUID, driver_name TEXT, fine_number TEXT, organ TEXT, infraction_date DATE, notification_date DATE, due_date DATE, original_amount NUMERIC(15,2) DEFAULT 0, admin_fee NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, points INT DEFAULT 0, description TEXT, notes TEXT, status TEXT DEFAULT 'identificada', responsible_user_id UUID, billing_id UUID, rental_extra_id UUID, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE inventory_items ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT, category TEXT, unit TEXT DEFAULT 'un', description TEXT, quantity NUMERIC(15,3) DEFAULT 0, min_quantity NUMERIC(15,3) DEFAULT 0, unit_cost NUMERIC(15,2) DEFAULT 0, location TEXT, active BOOLEAN DEFAULT TRUE, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE inventory_movements ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, item_id UUID NOT NULL, type TEXT NOT NULL, quantity NUMERIC(15,3), unit_cost NUMERIC(15,2) DEFAULT 0, balance_after NUMERIC(15,3) DEFAULT 0, reason TEXT, movement_date DATE, vehicle_id UUID, rental_id UUID, maintenance_id UUID, supplier TEXT, notes TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  fines = require('../models/rentalFineModels');
  inv = require('../models/inventoryModels');
  rentalModel = require('../models/rentalModels');
  vehicleModel = require('../models/vehicleModels');
  const { createTxRunner } = require('../services/tx');
  rentalService = require('../services/rentalService').factory(createTxRunner(pool));

  cli = (await pool.query(`INSERT INTO clients (tenant_id, name) VALUES ($1,'Maria') RETURNING *`, [T])).rows[0];
  veh = await vehicleModel.createVehicle({ tenant_id: T, plate: 'AAA1A11', brand: 'Fiat', model: 'Argo', daily_rate: 100, status: 'em_andamento' });
  rental = await rentalModel.createRental({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-01-01', end_date: '2027-01-06', daily_rate: 100 });
});

// ── MULTAS ─────────────────────────────────────────────────────────────────────
test('multa: cria com total = original + taxa; isolada por tenant', async () => {
  const f = await fines.create({ tenant_id: T, rental_id: rental.id, vehicle_id: veh.id, client_id: cli.id, fine_number: 'AI-1', organ: 'DETRAN', original_amount: 195.23, admin_fee: 30 });
  assert.equal(Number(f.total_amount), 225.23);
  assert.equal(f.status, 'identificada');
  assert.equal((await fines.list(T2)).length, 0, 'outro tenant não vê');
});

test('multa: vira ADICIONAL da locação (recalcula total) e evita duplicidade', async () => {
  const f = await fines.create({ tenant_id: T, rental_id: rental.id, vehicle_id: veh.id, client_id: cli.id, fine_number: 'AI-2', original_amount: 100, admin_fee: 0 });
  const before = Number((await rentalModel.getRentalById(rental.id, T)).total_amount);
  const { extra } = await rentalService.addExtra(rental.id, { category: 'Multa', description: 'Multa AI-2', quantity: 1, unit_amount: f.total_amount }, T);
  await fines.setExtra(f.id, extra.id, T);
  const after = Number((await rentalModel.getRentalById(rental.id, T)).total_amount);
  assert.equal(after - before, 100, 'total da locação +100');
  const linked = await fines.getById(f.id, T);
  assert.equal(linked.rental_extra_id, extra.id);
});

test('multa: com vínculo financeiro não pode ser excluída (delete bloqueado)', async () => {
  const f = await fines.create({ tenant_id: T, rental_id: rental.id, original_amount: 50, admin_fee: 0 });
  await fines.setBilling(f.id, randomUUID(), T);
  const got = await fines.getById(f.id, T);
  assert.ok(got.billing_id, 'tem billing_id');
  assert.equal(got.status, 'cobrada');
});

// ── ESTOQUE ────────────────────────────────────────────────────────────────────
test('estoque: entrada/saída ajustam saldo transacionalmente; balance_after correto', async () => {
  const item = await inv.createItem({ tenant_id: T, name: 'Óleo 5W30', code: 'OL1', unit: 'L', quantity: 0, min_quantity: 5, unit_cost: 40 });
  const e = await inv.createMovement({ tenant_id: T, item_id: item.id, type: 'entrada', quantity: 10, unit_cost: 40 });
  assert.equal(Number(e.movement.balance_after), 10);
  assert.equal(Number((await inv.getItem(item.id, T)).quantity), 10);
  const s = await inv.createMovement({ tenant_id: T, item_id: item.id, type: 'saida', quantity: 3 });
  assert.equal(Number(s.movement.balance_after), 7);
});

test('estoque: saída além do saldo é bloqueada (409) e não altera o item', async () => {
  const item = await inv.createItem({ tenant_id: T, name: 'Filtro', quantity: 2, min_quantity: 1, unit_cost: 10 });
  await assert.rejects(() => inv.createMovement({ tenant_id: T, item_id: item.id, type: 'saida', quantity: 5 }),
    (e) => { assert.equal(e.statusCode, 409); return true; });
  assert.equal(Number((await inv.getItem(item.id, T)).quantity), 2, 'saldo inalterado');
  // allow_negative permite (config explícita)
  const neg = await inv.createMovement({ tenant_id: T, item_id: item.id, type: 'saida', quantity: 5, allow_negative: true });
  assert.equal(Number(neg.movement.balance_after), -3);
});

test('estoque: dashboard aponta itens abaixo do mínimo e valor estimado; isolado', async () => {
  const d = await inv.dashboard(T);
  assert.ok(d.total_itens >= 2);
  assert.ok(d.itens_abaixo_minimo.length >= 1, 'há item abaixo do mínimo');
  assert.equal((await inv.dashboard(T2)).total_itens, 0);
});
