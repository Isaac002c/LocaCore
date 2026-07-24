'use strict';
// =============================================================================
// Runner de MIGRATIONS (scripts/migrate.js) — controle, idempotência e drift.
// Usa fixtures .sql simples em diretório temporário (o objetivo é validar o
// MECANISMO do runner, não a DDL real — que roda em Postgres real).
// =============================================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { newDb } = require('pg-mem');
const { createMigrator } = require('../scripts/migrate');

let pool, dir;

before(() => {
  // noAstCoverageCheck: pg-mem, no adapter pg, dispara "AST não lido" ao pular um
  // CREATE TABLE IF NOT EXISTS já existente (ensureTable roda várias vezes). Em
  // Postgres real isso é normal; desativamos a checagem estrita só no teste.
  const db = newDb({ noAstCoverageCheck: true });
  pool = new (db.adapters.createPg().Pool)();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loca-mig-'));
  fs.writeFileSync(path.join(dir, 'm1.sql'), 'CREATE TABLE a (id INT PRIMARY KEY);');
  fs.writeFileSync(path.join(dir, 'm2.sql'), 'CREATE TABLE b (id INT PRIMARY KEY);');
  fs.writeFileSync(path.join(dir, 'm2_rollback.sql'), 'DROP TABLE b;');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ migrations: ['m1.sql', 'm2.sql'] }));
});
after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

test('status: tudo pendente antes de aplicar', async () => {
  const m = createMigrator({ pool, dir, environment: 'test' });
  const s = await m.status();
  assert.equal(s.length, 2);
  assert.ok(s.every((x) => x.state === 'pending'));
});

test('up: aplica todas e registra em schema_migrations', async () => {
  const m = createMigrator({ pool, dir, environment: 'test' });
  const r = await m.up();
  assert.deepEqual(r.map((x) => x.action), ['applied', 'applied']);
  const rows = (await pool.query('SELECT name, success FROM schema_migrations ORDER BY name')).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.success === true));
  // tabelas criadas
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM a')).rows[0].n, 0);
});

test('up (2ª vez): idempotente — pula as já aplicadas', async () => {
  const m = createMigrator({ pool, dir, environment: 'test' });
  const r = await m.up();
  assert.deepEqual(r.map((x) => x.action), ['skip', 'skip']);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM schema_migrations')).rows[0].n, 2);
});

test('verify: sem drift quando arquivos inalterados', async () => {
  const m = createMigrator({ pool, dir, environment: 'test' });
  const v = await m.verify();
  assert.equal(v.ok, true);
  assert.deepEqual(v.drift, []);
});

test('drift: editar migration já aplicada é detectado e bloqueia up', async () => {
  fs.writeFileSync(path.join(dir, 'm1.sql'), 'CREATE TABLE a (id INT PRIMARY KEY, x INT);'); // mudou o checksum
  const m = createMigrator({ pool, dir, environment: 'test' });
  const v = await m.verify();
  assert.equal(v.ok, false);
  assert.deepEqual(v.drift, ['m1.sql']);
  await assert.rejects(() => m.up(), /Drift/);
  // restaura para não afetar outros testes
  fs.writeFileSync(path.join(dir, 'm1.sql'), 'CREATE TABLE a (id INT PRIMARY KEY);');
});

test('rollback: reverte a migration e remove o registro', async () => {
  const m = createMigrator({ pool, dir, environment: 'test' });
  const r = await m.rollback('m2.sql');
  assert.equal(r.action, 'rolled_back');
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM schema_migrations WHERE name='m2.sql'`)).rows[0].n, 0);
  // a migration volta a ficar pendente
  const s = await m.status();
  assert.equal(s.find((x) => x.name === 'm2.sql').state, 'pending');
});
