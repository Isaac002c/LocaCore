'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');

test('migration do ciclo 12 adiciona numeração DPS sem reescrever documentos', () => {
  const db = newDb();
  db.public.none(`
    CREATE TABLE automation_settings (tenant_id TEXT PRIMARY KEY, updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE fiscal_documents (id TEXT PRIMARY KEY, tenant_id TEXT, status TEXT);
    INSERT INTO automation_settings (tenant_id) VALUES ('t1');
    INSERT INTO fiscal_documents (id,tenant_id,status) VALUES ('f1','t1','pending');
  `);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle12.sql'), 'utf8');
  db.public.none(sql);
  const settings = db.public.one("SELECT last_dps_number FROM automation_settings WHERE tenant_id='t1'");
  const fiscal = db.public.one("SELECT id,dps_number,dps_series,status FROM fiscal_documents WHERE id='f1'");
  assert.equal(Number(settings.last_dps_number), 0);
  assert.deepEqual(fiscal, { id: 'f1', dps_number: null, dps_series: null, status: 'pending' });
  db.public.none("INSERT INTO fiscal_documents (id,tenant_id,status,dps_number,dps_series) VALUES ('f2','t1','pending',1,'90001')");
  assert.throws(() => db.public.none("INSERT INTO fiscal_documents (id,tenant_id,status,dps_number,dps_series) VALUES ('f3','t1','pending',1,'90001')"));
});

