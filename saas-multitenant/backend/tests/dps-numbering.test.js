'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { newDb } = require('pg-mem');

let pool;
let models;

before(() => {
  const db = newDb();
  db.public.none(`
    CREATE TABLE automation_settings (
      tenant_id TEXT PRIMARY KEY, last_dps_number BIGINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE fiscal_documents (
      id TEXT PRIMARY KEY, tenant_id TEXT, dps_number BIGINT, dps_series TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO automation_settings (tenant_id) VALUES ('t1');
    INSERT INTO fiscal_documents (id,tenant_id) VALUES ('f1','t1'),('f2','t1');
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  models = require('../models/automationModels');
});

test('numeração DPS é crescente e a retentativa conserva a identidade', async () => {
  const first = await models.reserveFiscalDpsIdentity('t1', 'f1', '00001');
  const retry = await models.reserveFiscalDpsIdentity('t1', 'f1', '00001');
  const second = await models.reserveFiscalDpsIdentity('t1', 'f2', '00001');
  assert.deepEqual(first, { number: '1', series: '00001' });
  assert.deepEqual(retry, first);
  assert.deepEqual(second, { number: '2', series: '00001' });
  assert.equal(Number((await pool.query("SELECT last_dps_number FROM automation_settings WHERE tenant_id='t1'")).rows[0].last_dps_number), 2);
});

