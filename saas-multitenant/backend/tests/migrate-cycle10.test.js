'use strict';

// Valida que a migration do Ciclo 10 aplica sobre o schema anterior (Ciclo 9)
// sem reescrever dados: adiciona as flags de recibo/NFS-e e a data-porteiro com
// defaults seguros e preserva a linha de settings existente (§50).

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { newDb, DataType } = require('pg-mem');

test('migration do ciclo 10 adiciona flags e nfse_mandatory_from com defaults seguros', async () => {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    CREATE TABLE rentals (id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id));
    CREATE TABLE automation_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID UNIQUE REFERENCES tenants(id),
      fiscal_mode VARCHAR(20) NOT NULL DEFAULT 'after_payment',
      billing_timezone VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo'
    );
    CREATE TABLE receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id),
      payment_id UUID, full_number TEXT
    );
    INSERT INTO tenants (id) VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO automation_settings (tenant_id) VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO receipts (tenant_id, payment_id, full_number) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa','REC-1');
  `);

  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle10.sql'), 'utf8');
  db.public.none(sql);

  // Colunas novas passaram a existir.
  const settingsCols = db.public.many(`SELECT column_name FROM information_schema.columns WHERE table_name='automation_settings'`).map((r) => r.column_name);
  for (const col of ['payments_enabled', 'receipts_enabled', 'nfse_enabled', 'nfse_mandatory_from', 'document_auto_send']) {
    assert.ok(settingsCols.includes(col), `coluna ${col} criada`);
  }

  // Uma NOVA linha recebe os defaults seguros (recibo off, envio on, data não inventada).
  db.public.none(`INSERT INTO tenants (id) VALUES ('00000000-0000-4000-8000-000000000002')`);
  db.public.none(`INSERT INTO automation_settings (tenant_id) VALUES ('00000000-0000-4000-8000-000000000002')`);
  const fresh = db.public.one(`SELECT receipts_enabled, nfse_enabled, payments_enabled, document_auto_send, nfse_mandatory_from
    FROM automation_settings WHERE tenant_id='00000000-0000-4000-8000-000000000002'`);
  assert.equal(fresh.receipts_enabled, false, 'default seguro: recibo desligado');
  assert.equal(fresh.nfse_enabled, false);
  assert.equal(fresh.payments_enabled, false);
  assert.equal(fresh.document_auto_send, true, 'envio de documento ligado por padrão');
  assert.equal(fresh.nfse_mandatory_from, null, 'data não é inventada pela migration');

  // Vínculo recibo→locação criado e dado antigo preservado (§50).
  const receiptCols = db.public.many(`SELECT column_name FROM information_schema.columns WHERE table_name='receipts'`).map((r) => r.column_name);
  assert.ok(receiptCols.includes('rental_id'));
  assert.equal(db.public.one("SELECT full_number FROM receipts WHERE full_number='REC-1'").full_number, 'REC-1');
});
