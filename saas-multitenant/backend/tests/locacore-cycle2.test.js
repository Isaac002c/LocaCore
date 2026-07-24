'use strict';
// =============================================================================
// LOCACORE — Ciclo 2 (produção): conflito/sobreposição (§3), transações e ciclo
// de vida atômicos (§4/§10), gating de módulo (§15), recibo pela locação (§7) e
// documentos da locação (§6). Exercita MODELS + SERVICES REAIS contra pg-mem.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, rentalModel, vehicleModel, tenantModel, documentModel, paymentModel, receiptService, rentalService;
let createTxRunner;
const T = 'tenant-1', T2 = 'tenant-2';
let cli, veh;

before(async () => {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });

  db.public.none(`
    CREATE TABLE tenants ( id TEXT PRIMARY KEY, name TEXT, slug TEXT, logo_url TEXT, brand_color TEXT, tagline TEXT, modules JSONB );
    CREATE TABLE users   ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT,
      category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
      odometer INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'disponivel', notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE rentals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID,
      status TEXT NOT NULL DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE,
      daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, days INT NOT NULL DEFAULT 1,
      extras_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, deposit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE service_billings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id UUID, company_id UUID, fine_id UUID, rental_id UUID,
      service_type_id INT, description TEXT, original_amount NUMERIC(15,2) DEFAULT 0, discount NUMERIC(15,2) DEFAULT 0,
      surcharge NUMERIC(15,2) DEFAULT 0, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0,
      installments INT DEFAULT 1, due_date DATE, payment_method TEXT, financial_status TEXT DEFAULT 'faturado',
      notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, billing_id UUID, client_id UUID, fine_id UUID, rental_id UUID,
      amount NUMERIC(15,2) NOT NULL, payment_date DATE, payment_method TEXT, status TEXT NOT NULL DEFAULT 'confirmado',
      installment_number INT DEFAULT 1, installments_total INT DEFAULT 1, is_deposit BOOLEAN DEFAULT FALSE, notes TEXT, created_by TEXT,
      canceled_at TIMESTAMPTZ, cancel_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, number INT NOT NULL, prefix TEXT NOT NULL, full_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'emitido', issue_date DATE, client_id UUID, payment_id UUID, billing_id UUID, fine_id UUID, rental_id UUID,
      client_name TEXT, client_document TEXT, service_description TEXT, amount NUMERIC(15,2) DEFAULT 0, payment_method TEXT,
      issuer_name TEXT, issuer_document TEXT, issuer_address TEXT, notes TEXT, created_by TEXT, created_by_name TEXT,
      canceled_at TIMESTAMPTZ, cancel_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_receipts_tenant_number UNIQUE (tenant_id, number)
    );
    CREATE TABLE tenant_financial_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL UNIQUE, receipt_prefix TEXT NOT NULL DEFAULT 'LOCA',
      last_receipt_number INT NOT NULL DEFAULT 0, razao_social TEXT, document TEXT, address TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, contract_id UUID, client_id UUID, company_id UUID,
      vehicle_id UUID, rental_id UUID, vehicle_asset_id UUID, file_url TEXT, file_name TEXT, file_type TEXT, file_size BIGINT,
      category TEXT DEFAULT 'outros', description TEXT, uploaded_by TEXT, uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE tenant_config_options (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE rental_extras (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID NOT NULL,
      category TEXT, description TEXT, quantity NUMERIC(12,2) NOT NULL DEFAULT 1, unit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, extra_date DATE, status TEXT NOT NULL DEFAULT 'ativo', created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const pg = db.adapters.createPg();
  pool = new pg.Pool();

  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  rentalModel = require('../models/rentalModels');
  vehicleModel = require('../models/vehicleModels');
  tenantModel = require('../models/tenantModels');
  documentModel = require('../models/documentModels');
  paymentModel = require('../models/paymentModels');
  receiptService = require('../services/finance/receiptService');
  const { createDbRepo } = require('../services/finance/financeRepo');
  receiptService._repo = createDbRepo(pool); // repo pg-mem para issueReceipt
  createTxRunner = require('../services/tx').createTxRunner;
  rentalService = require('../services/rentalService').factory(createTxRunner(pool));

  await pool.query(`INSERT INTO tenants (id, name, slug, modules) VALUES ($1,'Locadora','loc','["locacao","financeiro"]')`, [T]);
  await pool.query(`INSERT INTO tenants (id, name, slug, modules) VALUES ($1,'Despachante','desp','["multas"]')`, [T2]);
  cli = (await pool.query(`INSERT INTO clients (tenant_id, name, cpf) VALUES ($1,'Locatário','11111111111') RETURNING *`, [T])).rows[0];
  veh = await vehicleModel.createVehicle({ tenant_id: T, plate: 'AAA1A11', brand: 'Fiat', model: 'Argo', daily_rate: 100, status: 'disponivel' });
});

// Limpa locações entre grupos que dependem de estado isolado.
async function clearRentals() { await pool.query('DELETE FROM rentals'); await pool.query(`UPDATE vehicles SET status='disponivel'`); }

// ─────────────────────────── §3 SOBREPOSIÇÃO ───────────────────────────
test('conflito: helper detecta apenas sobreposições reais (matriz completa)', async () => {
  await clearRentals();
  const base = await rentalModel.createRental({
    tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado',
    start_date: '2026-07-10', end_date: '2026-07-15', daily_rate: 100,
  });
  const check = (s, e, exclude) => rentalModel.findConflictingRentals(
    { tenant_id: T, vehicle_id: veh.id, start_date: s, end_date: e, exclude_rental_id: exclude });

  assert.equal((await check('2026-07-16', '2026-07-20')).length, 0, 'depois');
  assert.equal((await check('2026-07-05', '2026-07-09')).length, 0, 'antes');
  assert.equal((await check('2026-07-15', '2026-07-18')).length, 0, 'adjacente no fim');
  assert.equal((await check('2026-07-08', '2026-07-10')).length, 0, 'adjacente no início');
  assert.equal((await check('2026-07-12', '2026-07-14')).length, 1, 'contido');
  assert.equal((await check('2026-07-08', '2026-07-20')).length, 1, 'contém a base');
  assert.equal((await check('2026-07-09', '2026-07-11')).length, 1, 'parcial início');
  assert.equal((await check('2026-07-14', '2026-07-16')).length, 1, 'parcial fim');
  assert.equal((await check('2026-07-12', '2026-07-14', base.id)).length, 0, 'exclui a própria (edição)');
});

test('conflito: cancelada/finalizada NÃO bloqueiam', async () => {
  await clearRentals();
  await rentalModel.createRental({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'cancelado', start_date: '2026-08-01', end_date: '2026-08-10', daily_rate: 100 });
  await rentalModel.createRental({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'finalizado', start_date: '2026-08-01', end_date: '2026-08-10', daily_rate: 100 });
  const c = await rentalModel.findConflictingRentals({ tenant_id: T, vehicle_id: veh.id, start_date: '2026-08-05', end_date: '2026-08-08' });
  assert.equal(c.length, 0);
});

test('conflito: não vaza entre tenants', async () => {
  await clearRentals();
  await rentalModel.createRental({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2026-09-01', end_date: '2026-09-10', daily_rate: 100 });
  const c = await rentalModel.findConflictingRentals({ tenant_id: T2, vehicle_id: veh.id, start_date: '2026-09-05', end_date: '2026-09-08' });
  assert.equal(c.length, 0);
});

test('conflito: service.create bloqueia sobreposição com 409', async () => {
  await clearRentals();
  await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2026-10-01', end_date: '2026-10-10', daily_rate: 100 });
  await assert.rejects(
    () => rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2026-10-05', end_date: '2026-10-08', daily_rate: 100 }),
    (err) => { assert.equal(err.statusCode, 409); return true; }
  );
});

// ─────────────────────────── §4/§10 TRANSAÇÕES + CICLO DE VIDA ───────────────────────────
test('ciclo de vida: reservado→em_andamento marca veículo alugado; devolução libera', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2026-11-01', end_date: '2026-11-05', daily_rate: 100, pickup_odometer: 1000 });
  // reserva futura NÃO ocupa o veículo
  assert.equal((await vehicleModel.getVehicleById(veh.id, T)).status, 'disponivel');

  await rentalService.changeStatus(r.id, 'em_andamento', T);
  assert.equal((await vehicleModel.getVehicleById(veh.id, T)).status, 'alugado');

  const { rental } = await rentalService.returnRental(r.id, { return_odometer: 1500 }, T);
  assert.equal(rental.status, 'finalizado');
  assert.equal((await vehicleModel.getVehicleById(veh.id, T)).status, 'disponivel');
  assert.equal(Number((await vehicleModel.getVehicleById(veh.id, T)).odometer), 1500);
});

test('ciclo de vida: transição inválida é rejeitada (reservado→finalizado)', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2026-12-01', end_date: '2026-12-05', daily_rate: 100 });
  await assert.rejects(() => rentalService.changeStatus(r.id, 'finalizado', T), (e) => { assert.equal(e.statusCode, 409); return true; });
});

test('devolução: hodômetro final menor que o inicial é rejeitado (400)', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2026-12-10', end_date: '2026-12-12', daily_rate: 100, pickup_odometer: 5000 });
  await assert.rejects(() => rentalService.returnRental(r.id, { return_odometer: 4000 }, T), (e) => { assert.equal(e.statusCode, 400); return true; });
  assert.equal((await rentalModel.getRentalById(r.id, T)).status, 'em_andamento', 'não finalizou');
});

// Atomicidade: pg-mem NÃO emula ROLLBACK de armazenamento, então validamos o
// MECANISMO da transação de forma determinística — BEGIN/COMMIT no sucesso e
// BEGIN/ROLLBACK no erro. Em Postgres real, o mesmo wrapper (idêntico ao
// financeRepo, já usado em produção) desfaz as escritas parciais.
test('transação: wrapper faz COMMIT no sucesso e ROLLBACK no erro', async () => {
  const makeFakePool = (record) => {
    const client = { query: async (sql) => { record.push(String(sql).trim().split(/\s+/)[0].toUpperCase()); return { rows: [] }; }, release: () => {} };
    return { connect: async () => client };
  };
  const ok = []; await createTxRunner(makeFakePool(ok))(async () => 'done');
  assert.deepEqual(ok, ['BEGIN', 'COMMIT']);

  const bad = [];
  await assert.rejects(() => createTxRunner(makeFakePool(bad))(async () => { throw new Error('boom'); }));
  assert.deepEqual(bad, ['BEGIN', 'ROLLBACK']);
});

test('cancelamento: reservado→cancelado com motivo; libera veículo e preserva histórico', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-02-01', end_date: '2027-02-05', daily_rate: 100 });
  const { rental } = await rentalService.cancelRental(r.id, { reason: 'desistência do cliente' }, T);
  assert.equal(rental.status, 'cancelado');
  assert.match(rental.notes || '', /desistência/);
  assert.equal((await vehicleModel.getVehicleById(veh.id, T)).status, 'disponivel');
});

// ─────────────────────────── §15 GATING DE MÓDULO ───────────────────────────
test('módulo: getTenantModules lê áreas habilitadas por tenant', async () => {
  assert.deepEqual(await tenantModel.getTenantModules(T), ['locacao', 'financeiro']);
  assert.deepEqual(await tenantModel.getTenantModules(T2), ['multas']);
});

test('módulo: requireModule bloqueia tenant sem locacao (403) e libera com', async () => {
  const { requireModule } = require('../middlewares/requireModule');
  const mw = requireModule('locacao');
  const run = (tenantId) => new Promise((resolve) => {
    const req = { tenantId };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { resolve(this.statusCode); } };
    mw(req, res, () => resolve('next'));
  });
  assert.equal(await run(T), 'next');       // locadora → passa
  assert.equal(await run(T2), 403);          // despachante → bloqueado
});

// ─────────────────────────── §7 RECIBO PELA LOCAÇÃO ───────────────────────────
test('recibo: emitido pela locação vincula rental_id e evita duplicidade', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-03-01', end_date: '2027-03-05', daily_rate: 100 });
  const billing = (await pool.query(`INSERT INTO service_billings (tenant_id, client_id, rental_id, final_amount, financial_status) VALUES ($1,$2,$3,500,'faturado') RETURNING *`, [T, cli.id, r.id])).rows[0];
  const payment = (await pool.query(`INSERT INTO payments (tenant_id, billing_id, client_id, amount, payment_date, payment_method, status) VALUES ($1,$2,$3,500,'2027-03-05','pix','confirmado') RETURNING *`, [T, billing.id, cli.id])).rows[0];

  const byRental = await paymentModel.getPaymentsByRental(r.id, T);
  assert.equal(byRental.length, 1);
  assert.equal(byRental[0].receipt_id, null, 'ainda sem recibo');

  const receipt = await receiptService.issueReceipt({
    tenant_id: T, payment_id: payment.id, rental_id: r.id, billing_id: billing.id,
    client_id: cli.id, client_name: 'Locatário', service_description: 'Locação', amount: 500, payment_method: 'pix',
  }, receiptService._repo);
  assert.equal(receipt.rental_id, r.id, 'recibo vinculado à locação');

  // Já existe recibo ativo → nova emissão falha (evita duplicidade).
  await assert.rejects(() => receiptService.issueReceipt({ tenant_id: T, payment_id: payment.id, rental_id: r.id, amount: 500 }, receiptService._repo));
  const after = await paymentModel.getPaymentsByRental(r.id, T);
  assert.equal(after[0].receipt_id, receipt.id, 'pagamento agora aponta o recibo');
});

// ─────────────────────────── §9 ADICIONAIS (extras) ───────────────────────────
test('extras: adicionar recalcula o total; remover volta o total', async () => {
  await clearRentals();
  await pool.query('DELETE FROM rental_extras');
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-05-01', end_date: '2027-05-06', daily_rate: 100 });
  // total inicial = 100 × 5 diárias = 500
  assert.equal(Number((await rentalModel.getRentalById(r.id, T)).total_amount), 500);

  // + combustível: 2 × 90 = 180 → total 680
  const add = await rentalService.addExtra(r.id, { category: 'Combustível', description: 'Tanque', quantity: 2, unit_amount: 90 }, T);
  assert.equal(Number(add.extra.total_amount), 180);
  assert.equal(Number(add.rental.total_amount), 680);
  assert.equal(Number(add.rental.extras_amount), 180);

  // remove → total volta a 500
  const del = await rentalService.cancelExtra(r.id, add.extra.id, T);
  assert.equal(Number(del.rental.total_amount), 500);
  assert.equal(Number(del.rental.extras_amount), 0);
});

test('extras: isolados por tenant e por locação', async () => {
  await clearRentals();
  await pool.query('DELETE FROM rental_extras');
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-06-01', end_date: '2027-06-03', daily_rate: 100 });
  await rentalService.addExtra(r.id, { category: 'Lavagem', quantity: 1, unit_amount: 50 }, T);
  assert.equal((await require('../models/rentalExtraModels').listByRental(r.id, T)).length, 1);
  assert.equal((await require('../models/rentalExtraModels').listByRental(r.id, T2)).length, 0);
});

// ─────────────────────────── §8 CATEGORIAS CONFIGURÁVEIS ───────────────────────────
test('config: ensureDefaults semeia e listOptions respeita ativo/isolamento', async () => {
  const cfg = require('../models/configOptionModels');
  await cfg.ensureDefaults(T, 'vehicle_category', cfg.DEFAULTS.vehicle_category);
  const cats = await cfg.listOptions(T, 'vehicle_category');
  assert.ok(cats.length >= 5);
  assert.ok(cats.some((c) => c.value === 'SUV'));

  // Desativar não apaga; some da lista de ativos.
  const suv = cats.find((c) => c.value === 'SUV');
  await cfg.updateOption(suv.id, { active: false }, T);
  const actives = await cfg.listOptions(T, 'vehicle_category');
  assert.ok(!actives.some((c) => c.value === 'SUV'));
  const all = await cfg.listOptions(T, 'vehicle_category', { includeInactive: true });
  assert.ok(all.some((c) => c.value === 'SUV'), 'preservado, apenas inativo');

  // Isolamento: T2 não tem as categorias de T.
  assert.equal((await cfg.listOptions(T2, 'vehicle_category')).length, 0);
});

// ─────────────────────────── §6 DOCUMENTOS DA LOCAÇÃO ───────────────────────────
test('documentos: vinculados à locação, isolados por tenant', async () => {
  await clearRentals();
  const r = await rentalService.create({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'reservado', start_date: '2027-04-01', end_date: '2027-04-05', daily_rate: 100 });
  await documentModel.createDocument({ tenant_id: T, rental_id: r.id, client_id: cli.id, file_url: 'http://x/a.pdf', file_name: 'contrato.pdf', category: 'contrato_locacao' });

  const docsT = await documentModel.getDocumentsByRental(r.id, T);
  assert.equal(docsT.length, 1);
  assert.equal(docsT[0].category, 'contrato_locacao');

  const docsT2 = await documentModel.getDocumentsByRental(r.id, T2);
  assert.equal(docsT2.length, 0, 'outro tenant não enxerga');
});
