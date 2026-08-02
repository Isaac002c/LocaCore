'use strict';
// =============================================================================
// CANCELAR / EXCLUIR LOCAÇÃO — o vínculo financeiro não pode travar a operação.
//
// Regressão relatada: o usuário abria "Cancelar locação", informava o motivo e
// nada acontecia. O backend recusava com 409 ("Cancele/trate o faturamento no
// Financeiro antes") porque a locação tinha faturamento vinculado — um beco sem
// saída, já que faturar é parte do fluxo normal.
//
// Regra correta: o faturamento NÃO PAGO é cancelado JUNTO, na mesma transação.
// A única recusa que permanece é quando já entrou dinheiro — aí o caminho é
// estornar, para o estorno ficar registrado.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, rentalService, rentalModel, billingModel, vehicleModel;
const T = 'tenant-a';
let cliente;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT, category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) DEFAULT 0, odometer INT DEFAULT 0, status TEXT DEFAULT 'disponivel', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE, daily_rate NUMERIC(15,2) DEFAULT 0, days INT DEFAULT 1, extras_amount NUMERIC(15,2) DEFAULT 0, discount_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0, pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
    CREATE TABLE service_billings ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id UUID, company_id UUID, fine_id UUID, rental_id UUID, service_type_id INT, description TEXT, original_amount NUMERIC(15,2) DEFAULT 0, discount NUMERIC(15,2) DEFAULT 0, surcharge NUMERIC(15,2) DEFAULT 0, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0, installments INT DEFAULT 1, due_date DATE, payment_method TEXT, financial_status TEXT DEFAULT 'faturado', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
    CREATE TABLE rental_extras ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID NOT NULL, category TEXT, description TEXT, quantity NUMERIC(12,2) DEFAULT 1, unit_amount NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, extra_date DATE, status TEXT DEFAULT 'ativo', created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  rentalModel = require('../models/rentalModels');
  billingModel = require('../models/serviceBillingModels');
  vehicleModel = require('../models/vehicleModels');
  const { createTxRunner } = require('../services/tx');
  rentalService = require('../services/rentalService').factory(createTxRunner(pool));

  cliente = (await pool.query(`INSERT INTO clients (tenant_id,name) VALUES ($1,'Isaac') RETURNING *`, [T])).rows[0];
});

let placa = 0;
const novoVeiculo = () => vehicleModel.createVehicle({
  tenant_id: T, plate: `CNC${(placa += 1).toString().padStart(4, '0')}`,
  brand: 'Teste', model: 'Cancel', daily_rate: 100, status: 'disponivel',
});

const novaLocacao = async (veiculo, ini = '2027-05-01', fim = '2027-05-05') =>
  rentalService.create({
    tenant_id: T, client_id: cliente.id, vehicle_id: veiculo.id,
    status: 'reservado', start_date: ini, end_date: fim, daily_rate: 100,
  });

const faturar = (rental, { pago = 0 } = {}) => billingModel.createBilling({
  tenant_id: T, client_id: cliente.id, rental_id: rental.id,
  description: `Locação ${rental.rental_number}`,
  original_amount: rental.total_amount, final_amount: rental.total_amount,
  paid_amount: pago, financial_status: pago > 0 ? 'parcial' : 'faturado',
});

// ── Cancelamento ────────────────────────────────────────────────────────────
test('REGRESSÃO: cancela locação COM faturamento não pago (era 409)', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await faturar(r);

  const { rental, canceledBillings } = await rentalService.cancelRental(r.id, { reason: 'testee' }, T);
  assert.equal(rental.status, 'cancelado');
  assert.equal(canceledBillings, 1, 'o faturamento deve ser cancelado junto');

  const ativos = await billingModel.getActiveBillingsByRentalForUpdate(r.id, T);
  assert.equal(ativos.length, 0, 'não pode sobrar faturamento ativo órfão');
});

test('cancelar libera o veículo', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await faturar(r);
  await rentalService.cancelRental(r.id, { reason: 'desistiu' }, T);
  const veiculo = await vehicleModel.getVehicleById(v.id, T);
  assert.equal(veiculo.status, 'disponivel');
});

test('cancela locação SEM faturamento (não regrediu)', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  const { rental, canceledBillings } = await rentalService.cancelRental(r.id, { reason: 'testee' }, T);
  assert.equal(rental.status, 'cancelado');
  assert.equal(canceledBillings, 0);
});

test('cancela com VÁRIOS faturamentos abertos — todos juntos', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await faturar(r); await faturar(r); await faturar(r);
  const { canceledBillings } = await rentalService.cancelRental(r.id, { reason: 'testee' }, T);
  assert.equal(canceledBillings, 3);
  assert.equal((await billingModel.getActiveBillingsByRentalForUpdate(r.id, T)).length, 0);
});

test('RECUSA cancelar quando já houve pagamento, explicando o valor', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await faturar(r, { pago: 250 });

  await assert.rejects(
    () => rentalService.cancelRental(r.id, { reason: 'testee' }, T),
    (e) => {
      assert.equal(e.statusCode, 409);
      assert.match(e.message, /250,00/, 'a mensagem deve dizer QUANTO já foi pago');
      assert.match(e.message, /[Ee]storne/, 'e apontar o caminho: estornar');
      return true;
    },
  );
});

test('pagamento bloqueia, mas o faturamento NÃO é cancelado (rollback)', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await faturar(r, { pago: 100 });
  await faturar(r); // um segundo, não pago

  await assert.rejects(() => rentalService.cancelRental(r.id, { reason: 'x' }, T));

  const ativos = await billingModel.getActiveBillingsByRentalForUpdate(r.id, T);
  assert.equal(ativos.length, 2, 'a transação inteira volta atrás — nada é cancelado pela metade');
  const rental = await rentalModel.getRentalById(r.id, T);
  assert.notEqual(rental.status, 'cancelado', 'a locação também não pode ter sido cancelada');
});

test('locação já cancelada e finalizada continuam protegidas', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await rentalService.cancelRental(r.id, { reason: 'primeira' }, T);
  await assert.rejects(
    () => rentalService.cancelRental(r.id, { reason: 'segunda' }, T),
    (e) => { assert.equal(e.statusCode, 409); assert.match(e.message, /já cancelada/i); return true; },
  );
});

test('isolamento: não cancela locação de outro tenant', async () => {
  const v = await novoVeiculo();
  const r = await novaLocacao(v);
  await assert.rejects(
    () => rentalService.cancelRental(r.id, { reason: 'testee' }, 'outro-tenant'),
    (e) => { assert.equal(e.statusCode, 404); return true; },
  );
});

// ── Contrato das rotas ──────────────────────────────────────────────────────
test('a rota de cancelar não bloqueia mais por faturamento vinculado', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'rentalRoutes.js'), 'utf8');
  assert.doesNotMatch(src, /Cancele\/trate o faturamento no Financeiro/,
    'a recusa genérica por faturamento vinculado não pode voltar');
  assert.match(src, /canceledBillings/, 'a rota deve reportar quantos faturamentos foram cancelados');
});

test('excluir locação só é recusado quando há PAGAMENTO', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'rentalRoutes.js'), 'utf8');
  assert.doesNotMatch(src, /Cancele a locação em vez de excluir/, 'recusa genérica removida');
  assert.match(src, /Number\(b\.paid_amount\) > 0/, 'a recusa passa a olhar o pagamento');
});

test('excluir multa cancela o vínculo financeiro em vez de recusar', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'rentalFineRoutes.js'), 'utf8');
  assert.doesNotMatch(src, /Multa com vínculo financeiro\. Cancele-a em vez de excluir/, 'recusa genérica removida');
  assert.match(src, /cancelBilling/, 'o faturamento vinculado é cancelado junto');
  assert.match(src, /paid_amount/, 'mas pagamento recebido continua protegido');
});

test('a Agenda permite EDITAR evento manual', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'locacao', 'Calendario.jsx'), 'utf8');
  assert.match(src, /updateEvent/, 'deve importar/usar o update');
  assert.match(src, /const openEdit/, 'deve ter ação de editar');
  assert.match(src, />Editar</, 'e o botão na linha do evento');
  // Evento derivado (retirada/devolução) continua não editável na agenda.
  assert.match(src, /ev\.source !== 'manual'/, 'derivado não pode ser editado aqui');
});
