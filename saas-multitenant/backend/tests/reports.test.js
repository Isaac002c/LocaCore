'use strict';
// =============================================================================
// C5 — Dashboard/Relatórios (§): overview consolida frota/locações/multas/estoque/
// financeiro; relatórios de faturamento e locações por período; isolamento por tenant.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, reports;
const T = 't1', T2 = 't2';
const T_ISO = new Date().toISOString().substring(0, 10);

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT, status TEXT DEFAULT 'disponivel' );
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'em_andamento', start_date DATE, end_date DATE, daily_rate NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0, deposit_amount NUMERIC(15,2) DEFAULT 0 );
    CREATE TABLE rental_fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, total_amount NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'identificada' );
    CREATE TABLE inventory_items ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, active BOOLEAN DEFAULT TRUE, quantity NUMERIC(15,3) DEFAULT 0, min_quantity NUMERIC(15,3) DEFAULT 0 );
    CREATE TABLE service_billings ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, client_id UUID, rental_id UUID, description TEXT, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0, financial_status TEXT DEFAULT 'faturado', created_at TIMESTAMPTZ DEFAULT NOW() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  reports = require('../models/reportModels');

  const cli = (await pool.query(`INSERT INTO clients (tenant_id, name) VALUES ($1,'Ana') RETURNING *`, [T])).rows[0];
  const v1 = (await pool.query(`INSERT INTO vehicles (tenant_id, plate, status) VALUES ($1,'AAA1A11','alugado') RETURNING *`, [T])).rows[0];
  await pool.query(`INSERT INTO vehicles (tenant_id, plate, status) VALUES ($1,'BBB2B22','disponivel'),($1,'CCC3C33','manutencao')`, [T]);
  await pool.query(`INSERT INTO rentals (tenant_id, rental_number, client_id, vehicle_id, status, start_date, end_date, daily_rate, total_amount, deposit_amount) VALUES ($1,'LOC-1',$2,$3,'em_andamento',$4,$4,20,500,200)`, [T, cli.id, v1.id, T_ISO]);
  await pool.query(`INSERT INTO rentals (tenant_id, rental_number, status, start_date, end_date, daily_rate, total_amount) VALUES ($1,'LOC-2','atrasado',$2,$2,10,300)`, [T, T_ISO]);
  await pool.query(`INSERT INTO rental_fines (tenant_id, total_amount, status) VALUES ($1,150,'identificada'),($1,80,'paga')`, [T]);
  await pool.query(`INSERT INTO inventory_items (tenant_id, active, quantity, min_quantity) VALUES ($1,true,2,5),($1,true,10,3)`, [T]);
  await pool.query(`INSERT INTO service_billings (tenant_id, client_id, rental_id, description, final_amount, paid_amount, financial_status) VALUES ($1,$2,$3,'Locação LOC-1',500,200,'faturado')`, [T, cli.id, v1.id]);
  // Ruído em outro tenant
  await pool.query(`INSERT INTO vehicles (tenant_id, plate, status) VALUES ($1,'ZZZ9Z99','alugado')`, [T2]);
});

test('overview: agrega frota, locações, hoje, multas, estoque e financeiro', async () => {
  const o = await reports.overview(T);
  assert.equal(o.fleet.total, 3);
  assert.equal(o.fleet.alugado, 1);
  assert.equal(o.fleet.manutencao, 1);
  assert.equal(o.rentals.ativas, 2, 'em_andamento + atrasado');
  assert.equal(o.rentals.atrasado, 1);
  assert.equal(o.hoje.retiradas, 1, 'LOC-1 inicia hoje');
  assert.equal(o.hoje.devolucoes, 2, 'ambas terminam hoje e estão ativas');
  assert.equal(o.multas.abertas, 1, 'só a não-paga conta');
  assert.equal(Number(o.multas.valor), 150);
  assert.equal(o.estoque.abaixo_minimo, 1);
  assert.equal(Number(o.financeiro.faturado_mes), 500);
  assert.equal(Number(o.financeiro.recebido_mes), 200);
  assert.equal(Number(o.financeiro.valor_em_aberto), 800, 'total das locações ativas');
  assert.equal(Number(o.financeiro.valor_mensal), 900, 'projeção de 30 dias das locações em curso');
  assert.equal(Number(o.financeiro.caucao_retida), 200);
});

test('revenue: soma faturado/recebido do período', async () => {
  const rep = await reports.revenue(T, { from: T_ISO, to: T_ISO });
  assert.equal(rep.rows.length, 1);
  assert.equal(Number(rep.totals.faturado), 500);
  assert.equal(Number(rep.totals.recebido), 200);
});

test('rentalsReport: filtra por status e soma total', async () => {
  const all = await reports.rentalsReport(T, {});
  assert.equal(all.rows.length, 2);
  assert.equal(Number(all.total), 800);
  const atrasadas = await reports.rentalsReport(T, { status: 'atrasado' });
  assert.equal(atrasadas.rows.length, 1);
  assert.equal(Number(atrasadas.total), 300);
});

test('fleetUtilization: taxa de ocupação = alugados/total', async () => {
  const u = await reports.fleetUtilization(T);
  assert.equal(u.total, 3);
  assert.equal(u.taxa_ocupacao, 33);
});

test('isolamento: T2 vê apenas seus próprios dados', async () => {
  const o = await reports.overview(T2);
  assert.equal(o.fleet.total, 1);
  assert.equal(o.rentals.ativas, 0);
  assert.equal(Number(o.financeiro.faturado_mes), 0);
});
