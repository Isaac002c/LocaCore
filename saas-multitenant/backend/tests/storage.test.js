'use strict';
// =============================================================================
// C5 — Abstração de Storage (§ Storage): provedor local (default), metadados em
// storage_objects (sem segredos), isolamento por tenant e S3 GATED (sem config
// não simula upload — reporta configured:false / STORAGE_NOT_CONFIGURED).
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');

let pool, storageObjects, storage;
const T = 't1', T2 = 't2';

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE storage_objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, provider TEXT DEFAULT 'local',
      bucket TEXT, object_key TEXT NOT NULL, category TEXT, entity_type TEXT, entity_id UUID,
      file_name TEXT, content_type TEXT, size BIGINT, checksum TEXT, created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  storageObjects = require('../models/storageObjectModels');
  storage = require('../services/storage');
});

beforeEach(() => { storage._resetProvider(); delete process.env.STORAGE_PROVIDER; });

test('provedor default é local e está sempre configurado', () => {
  const p = storage.getProvider();
  assert.equal(p.name, 'local');
  assert.equal(p.configured(), true);
});

test('local: put grava o arquivo e publicUrl aponta para /uploads/<tenant>/<key>', async () => {
  const key = storage.safeName('contrato.pdf');
  const buffer = Buffer.from('%PDF-1.4 conteudo');
  const p = storage.getProvider();
  const out = await p.put({ tenantId: T, key, buffer, contentType: 'application/pdf' });
  assert.equal(out.provider, 'local');
  const dest = path.join(storage.UPLOAD_ROOT, T, key);
  assert.ok(fs.existsSync(dest), 'arquivo persistido em disco');
  const url = p.publicUrl({ tenantId: T, key });
  assert.match(url, new RegExp(`/uploads/${T}/${key}$`));
  fs.rmSync(dest, { force: true });
});

test('safeName gera chave única sem traversal e preserva extensão', () => {
  const a = storage.safeName('../../etc/passwd.png');
  const b = storage.safeName('../../etc/passwd.png');
  assert.notEqual(a, b, 'nomes únicos');
  assert.ok(a.endsWith('.png'));
  assert.ok(!a.includes('/') && !a.includes('..'), 'sem separadores de caminho');
});

test('storage_objects: registra metadados (sem segredos) e isola por tenant', async () => {
  const eid = randomUUID();
  const rec = await storageObjects.record({
    tenant_id: T, provider: 'local', object_key: `${T}/x.png`, category: 'vistoria',
    entity_type: 'rental', entity_id: eid, file_name: 'x.png', content_type: 'image/png', size: 1234,
  });
  assert.ok(rec.id);
  assert.equal(rec.bucket, null, 'sem bucket p/ local');
  assert.ok(!('secret' in rec) && !('credentials' in rec), 'nenhum segredo persistido');
  const mine = await storageObjects.listByEntity(T, 'rental', eid);
  assert.equal(mine.length, 1);
  assert.equal((await storageObjects.listByEntity(T2, 'rental', eid)).length, 0, 'outro tenant não vê');
});

test('S3 GATED: sem credenciais, configured=false e put lança STORAGE_NOT_CONFIGURED', async () => {
  process.env.STORAGE_PROVIDER = 's3';
  delete process.env.S3_BUCKET; delete process.env.S3_REGION;
  const s3 = storage.makeS3Provider();
  assert.equal(s3.configured(), false, 'não configurado sem bucket/region/credenciais');
  await assert.rejects(() => s3.put({ tenantId: T, key: 'k.png', buffer: Buffer.from('x') }),
    (e) => { assert.equal(e.code, 'STORAGE_NOT_CONFIGURED'); return true; });
  // getProvider cai para local (não simula S3 concluído)
  storage._resetProvider();
  assert.equal(storage.getProvider().name, 'local', 'fallback seguro para local');
});
