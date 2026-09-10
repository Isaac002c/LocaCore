'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newDb } = require('pg-mem');

test('migration do ciclo 11 vincula uma única cópia da nota à pasta do cliente', () => {
  const db = newDb();
  db.public.none(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    CREATE TABLE fiscal_documents (id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id));
    CREATE TABLE documents (
      id UUID PRIMARY KEY, tenant_id UUID REFERENCES tenants(id), client_id UUID,
      file_url TEXT NOT NULL, file_name TEXT
    );
    INSERT INTO tenants VALUES ('00000000-0000-4000-8000-000000000001');
    INSERT INTO fiscal_documents VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
    INSERT INTO documents VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001',NULL,'/antigo.pdf','Antigo.pdf');
  `);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle11.sql'), 'utf8');
  db.public.none(sql);
  assert.equal(db.public.one("SELECT file_name FROM documents WHERE id='00000000-0000-4000-8000-000000000003'").file_name, 'Antigo.pdf');
  db.public.none(`UPDATE documents SET fiscal_document_id='00000000-0000-4000-8000-000000000002'
    WHERE id='00000000-0000-4000-8000-000000000003'`);
  db.public.none(`INSERT INTO documents (id,tenant_id,file_url,file_name)
    VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','/nova.pdf','Nova.pdf')`);
  assert.throws(() => db.public.none(`UPDATE documents SET fiscal_document_id='00000000-0000-4000-8000-000000000002'
    WHERE id='00000000-0000-4000-8000-000000000004'`));
});

