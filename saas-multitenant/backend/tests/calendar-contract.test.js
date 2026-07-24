'use strict';
// =============================================================================
// C5 — Calendário operacional (§6): agenda agrega eventos MANUAIS + DERIVADOS
// (retirada/devolução, manutenções, multas), filtro por tipo e isolamento.
// Contrato de locação (§7): PDF gerado com assinatura %PDF válida.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, calendar;
const T = 't1', T2 = 't2';
const FROM = '2027-03-01', TO = '2027-03-31';
let cli, veh;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE users ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, is_active BOOLEAN DEFAULT TRUE );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT );
    CREATE TABLE rentals ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, rental_number TEXT, client_id UUID, vehicle_id UUID, status TEXT DEFAULT 'em_andamento', start_date DATE, end_date DATE );
    CREATE TABLE vehicle_maintenances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, vehicle_id UUID, type TEXT, scheduled_date DATE, status TEXT DEFAULT 'agendada' );
    CREATE TABLE rental_fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, fine_number TEXT, vehicle_id UUID, due_date DATE, status TEXT DEFAULT 'identificada' );
    CREATE TABLE calendar_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, title TEXT, description TEXT, event_date DATE, start_time TIME, end_time TIME, type TEXT DEFAULT 'outro', status TEXT DEFAULT 'agendado', priority TEXT, client_id UUID, rental_id UUID, vehicle_id UUID, maintenance_id UUID, responsible_user_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  calendar = require('../models/calendarEventModels');

  cli = (await pool.query(`INSERT INTO clients (tenant_id, name) VALUES ($1,'Ana') RETURNING *`, [T])).rows[0];
  veh = (await pool.query(`INSERT INTO vehicles (tenant_id, plate) VALUES ($1,'BRA2E19') RETURNING *`, [T])).rows[0];
  // Locação com retirada e devolução dentro do período
  await pool.query(`INSERT INTO rentals (tenant_id, rental_number, client_id, vehicle_id, status, start_date, end_date) VALUES ($1,'LOC-1',$2,$3,'em_andamento','2027-03-05','2027-03-10')`, [T, cli.id, veh.id]);
  // Manutenção agendada no período
  await pool.query(`INSERT INTO vehicle_maintenances (tenant_id, vehicle_id, type, scheduled_date, status) VALUES ($1,$2,'revisao','2027-03-12','agendada')`, [T, veh.id]);
  // Multa vencendo no período
  await pool.query(`INSERT INTO rental_fines (tenant_id, fine_number, vehicle_id, due_date, status) VALUES ($1,'AI-9',$2,'2027-03-20','identificada')`, [T, veh.id]);
  // Evento manual no período
  await pool.query(`INSERT INTO calendar_events (tenant_id, title, event_date, start_time, type, status) VALUES ($1,'Vistoria pátio','2027-03-08','09:00','tarefa','agendado')`, [T]);
  // Ruído em outro tenant
  await pool.query(`INSERT INTO calendar_events (tenant_id, title, event_date, type) VALUES ($1,'Outro tenant','2027-03-08','outro')`, [T2]);
});

test('agenda: agrega manual + derivados (retirada, devolução, manutenção, multa)', async () => {
  const ev = await calendar.listAgenda(T, { from: FROM, to: TO });
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('retirada'), 'tem retirada');
  assert.ok(types.includes('devolucao'), 'tem devolução');
  assert.ok(types.includes('manutencao'), 'tem manutenção');
  assert.ok(types.includes('multa'), 'tem multa');
  assert.ok(ev.some((e) => e.source === 'manual' && e.title === 'Vistoria pátio'), 'tem evento manual');
  // ordenado por data ascendente
  const dates = ev.map((e) => String(e.date).substring(0, 10));
  assert.deepEqual(dates, [...dates].sort(), 'ordenado por data');
});

test('agenda: filtro por tipo retorna só o tipo pedido', async () => {
  const ev = await calendar.listAgenda(T, { from: FROM, to: TO, type: 'retirada' });
  assert.ok(ev.length >= 1);
  assert.ok(ev.every((e) => e.type === 'retirada'), 'todos retirada');
});

test('agenda: isolada por tenant (T2 não vê eventos de T)', async () => {
  const ev = await calendar.listAgenda(T2, { from: FROM, to: TO });
  // T2 só tem o evento manual "Outro tenant"; nenhum derivado de T
  assert.ok(ev.every((e) => !e.vehicle_plate || e.vehicle_plate !== 'BRA2E19'), 'não vê veículo de T');
  assert.ok(!ev.some((e) => e.type === 'retirada' || e.type === 'multa'), 'sem derivados de T');
});

test('contrato: PDF gerado com assinatura %PDF válida', async () => {
  const { buildRentalContractPdf } = require('../services/finance/rentalContractPdf');
  const buf = await buildRentalContractPdf({
    rental: { rental_number: 'LOC-1', start_date: '2027-03-05', end_date: '2027-03-10', daily_rate: 100, days: 5, total_amount: 500, deposit_amount: 200, pickup_odometer: 12000 },
    client: { name: 'Ana', cpf: '12345678900', cnh: '99999999999', phone: '11999998888', address: 'Rua X, 100' },
    vehicle: { brand: 'Fiat', model: 'Argo', plate: 'BRA2E19', year: 2022, color: 'Prata', renavam: '123' },
    extras: [{ category: 'GPS', total_amount: 50 }],
    contract: { number: 'CTR-LOC-1-v1' },
    settings: { header: 'Locadora Teste', clauses: 'Cláusula 1.\nCláusula 2.', footer: 'Rodapé.' },
    branding: { name: 'LocaCore' },
  });
  assert.ok(Buffer.isBuffer(buf), 'retorna Buffer');
  assert.equal(buf.subarray(0, 4).toString('latin1'), '%PDF', 'assinatura %PDF');
  assert.ok(buf.length > 1000, 'PDF não vazio');
});
