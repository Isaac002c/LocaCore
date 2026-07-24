'use strict';
// =============================================================================
// C5 — Importação CSV (§17): parser tolerante (BOM, delimitador, aspas),
// validação por entidade (obrigatórios, duplicidade), e commit tenant-scoped
// com dedup no banco. tenant_id NUNCA vem da planilha — sempre o autenticado.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, clientModel, vehicleModel;
const { parseCsv, validate } = require('../services/csvImport');
const T = 't1', T2 = 't2';

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, birth_date DATE, cpf TEXT, cnh TEXT, first_cnh DATE, phone TEXT, email TEXT, address TEXT, notes TEXT, status TEXT DEFAULT 'negociacao', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE vehicles ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT, category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) DEFAULT 0, odometer INT DEFAULT 0, status TEXT DEFAULT 'disponivel', notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  clientModel = require('../models/clientModels');
  vehicleModel = require('../models/vehicleModels');
});

test('parseCsv: trata BOM, cabeçalho, delimitador ; e aspas com escape', () => {
  const csv = '﻿nome;cpf;observacoes\r\n"Silva, João";123;"disse ""ok"""\nMaria;456;simples';
  const { headers, rows } = parseCsv(csv);
  assert.deepEqual(headers, ['nome', 'cpf', 'observacoes']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].nome, 'Silva, João');
  assert.equal(rows[0].observacoes, 'disse "ok"');
  assert.equal(rows[1].cpf, '456');
});

test('validate clientes: nome obrigatório, e-mail inválido e duplicidade viram erro', () => {
  // linha1 válida; linha2 sem nome; linha3 cpf duplicado (e-mail ok); linha4 e-mail inválido
  const { rows } = parseCsv('nome,cpf,email\nMaria,111,maria@x.com\n,222,\nAna,111,ana@x.com\nBob,333,bad-email');
  const { valid, errors } = validate('clientes', rows);
  assert.equal(valid.length, 1, 'só a Maria válida');
  assert.equal(valid[0].data.cpf, '111');
  assert.ok(errors.some((e) => /obrigat/i.test(e.message)), 'linha sem nome');
  assert.ok(errors.some((e) => /duplicad/i.test(e.message)), 'cpf duplicado no arquivo');
  assert.ok(errors.some((e) => /mail/i.test(e.message)), 'e-mail inválido');
});

test('validate veiculos: placa obrigatória, diária inválida e normalização de placa', () => {
  const { rows } = parseCsv('placa;marca;diaria\nabc1d23;Fiat;120,50\n;Sem;10\nDEF4G56;VW;xyz');
  const { valid, errors } = validate('veiculos', rows);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].data.plate, 'ABC1D23', 'placa normalizada (upper, sem hífen)');
  assert.equal(valid[0].data.daily_rate, 120.5, 'diária pt-BR convertida');
  assert.ok(errors.some((e) => /placa/i.test(e.message)));
  assert.ok(errors.some((e) => /di[aá]ria/i.test(e.message)));
});

test('commit (simulado): insere válidos no tenant autenticado e deduplica', async () => {
  // Simula o loop de commit da rota: valida e insere no tenant T.
  const { rows } = parseCsv('nome,cpf\nAna,900\nBia,901');
  const { valid } = validate('clientes', rows);
  for (const { data } of valid) {
    if (data.cpf && await clientModel.getClientByCPF(data.cpf, T)) continue;
    await clientModel.createClient({ ...data, tenant_id: T });
  }
  const listT = await clientModel.getAllClients(T);
  assert.equal(listT.length, 2);
  // Reexecutar não duplica (dedup por CPF)
  for (const { data } of valid) {
    if (data.cpf && await clientModel.getClientByCPF(data.cpf, T)) continue;
    await clientModel.createClient({ ...data, tenant_id: T });
  }
  assert.equal((await clientModel.getAllClients(T)).length, 2, 'idempotente por CPF');
  // Isolamento: T2 não vê os clientes de T
  assert.equal((await clientModel.getAllClients(T2)).length, 0);
});
