'use strict';
// =============================================================================
// ASSENTOS DE USUÁRIO E CONTA PROTEGIDA (§11)
//
// Regra do contrato com a Rental Log:
//   · o tenant mantém no máximo `tenants.user_seats` usuários (padrão 4);
//   · a conta de suporte do fornecedor é IRREVOGÁVEL para o tenant e NÃO ocupa
//     assento — nem um admin do cliente pode editá-la, desativá-la ou excluí-la.
//
// Estes testes fixam a regra no servidor. A UI apenas reflete o que vem daqui.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, seats, permissionModel;
const T = 'tenant-rental-log';
const OUTRO = 'tenant-vizinho';

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT DEFAULT 'ativo',
      user_seats INT NOT NULL DEFAULT 4
    );
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
      name TEXT, email TEXT, password_hash TEXT, role TEXT DEFAULT 'viewer',
      is_active BOOLEAN DEFAULT TRUE,
      is_protected BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      last_login_at TIMESTAMPTZ, password_changed_at TIMESTAMPTZ,
      sessions_valid_after TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  seats = require('../services/userSeats');
  permissionModel = require('../models/permissionModels');
});

beforeEach(async () => {
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM tenants');
  await pool.query(`INSERT INTO tenants (id, name, slug, user_seats) VALUES ($1,'Rental Log','rental-log',4)`, [T]);
  await pool.query(`INSERT INTO tenants (id, name, slug, user_seats) VALUES ($1,'Vizinha','vizinha',4)`, [OUTRO]);
});

const criar = (tenant, nome, extra = {}) => permissionModel.createUser({
  tenant_id: tenant, name: nome, email: `${nome.toLowerCase()}@ex.com`,
  password: 'Senha-Inicial-123', role: extra.role || 'admin',
  ...extra,
});

const proteger = (id) => pool.query('UPDATE users SET is_protected = TRUE WHERE id = $1', [id]);

// ── Assentos ────────────────────────────────────────────────────────────────
test('limite padrão é 4 assentos por tenant', async () => {
  assert.equal(await seats.getSeatLimit(T), 4);
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.limit, 4);
  assert.equal(uso.used, 0);
  assert.equal(uso.available, 4);
  assert.equal(uso.can_create, true);
});

test('4 usuários preenchem os assentos; o 5º é recusado com 409', async () => {
  for (const n of ['Leandro', 'Fernando', 'Hugo', 'Empresa']) {
    await seats.assertCanCreateUser(T);
    await criar(T, n);
  }
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.used, 4);
  assert.equal(uso.available, 0);
  assert.equal(uso.can_create, false);

  await assert.rejects(
    () => seats.assertCanCreateUser(T),
    (e) => {
      assert.equal(e.statusCode, 409);
      assert.match(e.message, /Limite de 4 usuários/);
      return true;
    },
  );
});

test('a conta de suporte do fornecedor NÃO ocupa assento', async () => {
  const suporte = await criar(T, 'Suporte');
  await proteger(suporte.id);
  // Com a conta protegida no banco, os 4 assentos continuam livres.
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.used, 0, 'conta protegida não consome vaga');
  assert.equal(uso.available, 4);
  assert.equal(uso.protected_accounts, 1);

  for (const n of ['Leandro', 'Fernando', 'Hugo', 'Empresa']) {
    await seats.assertCanCreateUser(T);
    await criar(T, n);
  }
  const depois = await seats.getSeatUsage(T);
  assert.equal(depois.used, 4, 'os 4 do cliente cabem mesmo com o suporte presente');
  assert.equal(depois.can_create, false);

  const total = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1', [T]);
  assert.equal(total.rows[0].n, 5, '5 registros no banco: 4 do cliente + suporte');
});

test('excluir um usuário libera o assento', async () => {
  const ids = [];
  for (const n of ['A', 'B', 'C', 'D']) ids.push((await criar(T, n)).id);
  assert.equal((await seats.getSeatUsage(T)).can_create, false);

  await permissionModel.deleteUser(ids[0], T);
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.used, 3);
  assert.equal(uso.can_create, true);
  await seats.assertCanCreateUser(T); // não lança
});

test('usuário DESATIVADO continua ocupando assento (a vaga é do cadastro)', async () => {
  const ids = [];
  for (const n of ['A', 'B', 'C', 'D']) ids.push((await criar(T, n)).id);
  await permissionModel.setUserActive(ids[0], false, T);
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.used, 4, 'desativar não devolve a vaga — é preciso excluir');
  assert.equal(uso.can_create, false);
});

test('assentos são isolados por tenant', async () => {
  for (const n of ['A', 'B', 'C', 'D']) await criar(T, n);
  assert.equal((await seats.getSeatUsage(T)).can_create, false);
  assert.equal((await seats.getSeatUsage(OUTRO)).used, 0);
  await seats.assertCanCreateUser(OUTRO); // vizinho não é afetado
});

test('limite é parametrizável por tenant (plano diferente, sem mexer no código)', async () => {
  await pool.query('UPDATE tenants SET user_seats = 8 WHERE id = $1', [T]);
  assert.equal(await seats.getSeatLimit(T), 8);
  const uso = await seats.getSeatUsage(T);
  assert.equal(uso.limit, 8);
  assert.equal(uso.available, 8);
});

// ── Conta protegida ─────────────────────────────────────────────────────────
test('conta protegida não pode ser editada, desativada nem excluída', async () => {
  const suporte = await criar(T, 'Suporte');
  await proteger(suporte.id);
  const registro = await permissionModel.getUserById(suporte.id, T);
  assert.equal(registro.is_protected, true);

  for (const acao of ['editar', 'excluir', 'desativar']) {
    assert.throws(
      () => seats.assertNotProtected(registro, acao),
      (e) => {
        assert.equal(e.statusCode, 403);
        assert.match(e.message, /suporte da TELUN/);
        return true;
      },
      `ação "${acao}" deveria ser bloqueada`,
    );
  }
});

test('usuário comum do tenant continua editável', async () => {
  const u = await criar(T, 'Leandro');
  const registro = await permissionModel.getUserById(u.id, T);
  assert.equal(registro.is_protected, false);
  assert.doesNotThrow(() => seats.assertNotProtected(registro, 'editar'));
  assert.doesNotThrow(() => seats.assertNotProtected(registro, 'excluir'));
});

test('a conta protegida CONTINUA VISÍVEL na listagem (nada escondido do cliente)', async () => {
  const suporte = await criar(T, 'Suporte');
  await proteger(suporte.id);
  await criar(T, 'Leandro');

  const lista = await permissionModel.getUsersWithRoles(T);
  assert.equal(lista.length, 2);
  const marcada = lista.find((u) => u.id === suporte.id);
  assert.ok(marcada, 'a conta de suporte precisa aparecer para o cliente');
  assert.equal(marcada.is_protected, true, 'e vir marcada como protegida');
});

test('mensagem de erro explica que a conta de suporte não ocupa vaga', () => {
  try {
    seats.assertNotProtected({ is_protected: true }, 'excluir');
    assert.fail('deveria ter lançado');
  } catch (e) {
    assert.match(e.message, /não ocupa uma das vagas/);
  }
});

// ── Higiene de senha ────────────────────────────────────────────────────────
test('usuário criado por admin nasce com senha PROVISÓRIA', async () => {
  const u = await criar(T, 'Leandro');
  assert.equal(u.must_change_password, true, 'senha entregue por mensagem é provisória');
  const r = await permissionModel.getUserById(u.id, T);
  assert.equal(r.must_change_password, true);
  assert.ok(r.password_changed_at, 'registra quando a senha passou a valer');
});

test('definir a própria senha limpa a exigência e invalida sessões', async () => {
  const u = await criar(T, 'Leandro');
  await permissionModel.updateUserPassword(u.id, 'Minha-Nova-Senha-9', T); // forceChange padrão = false
  const r = await permissionModel.getUserById(u.id, T);
  assert.equal(r.must_change_password, false, 'a pessoa definiu a própria senha');

  const s = await pool.query('SELECT sessions_valid_after FROM users WHERE id = $1', [u.id]);
  assert.ok(s.rows[0].sessions_valid_after, 'sessões antigas invalidadas');
});

test('admin redefinindo senha de OUTRO marca a nova senha como provisória', async () => {
  const u = await criar(T, 'Leandro');
  await permissionModel.updateUserPassword(u.id, 'Temporaria-123', T, { forceChange: true });
  const r = await permissionModel.getUserById(u.id, T);
  assert.equal(r.must_change_password, true, 'quem recebe precisa trocar no primeiro acesso');
});

test('setMustChangePassword marca e desmarca sem tocar na senha', async () => {
  const u = await criar(T, 'Leandro');
  const antes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  await permissionModel.setMustChangePassword(u.id, false, T);
  assert.equal((await permissionModel.getUserById(u.id, T)).must_change_password, false);
  await permissionModel.setMustChangePassword(u.id, true, T);
  assert.equal((await permissionModel.getUserById(u.id, T)).must_change_password, true);
  const depois = await pool.query('SELECT password_hash FROM users WHERE id = $1', [u.id]);
  assert.equal(antes.rows[0].password_hash, depois.rows[0].password_hash, 'a senha não foi alterada');
});

// ── Contrato das rotas ──────────────────────────────────────────────────────
test('as rotas de usuário consultam o serviço de assentos em todas as ações', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'userManagementRoutes.js'), 'utf8');
  assert.match(src, /assertCanCreateUser/, 'POST deve validar assento');
  assert.match(src, /assertNotProtected\(existingUser, 'editar'\)/, 'PUT deve proteger a conta de suporte');
  assert.match(src, /assertNotProtected\(existingUser, 'excluir'\)/, 'DELETE deve proteger a conta de suporte');
  assert.match(src, /assertNotProtected\(existing, isActive \? 'reativar' : 'desativar'\)/, 'PATCH active deve proteger');
  assert.match(src, /isProtectedUser\(alvo\)/, 'troca de senha de terceiro deve proteger');
  assert.match(src, /seats: usage/, 'a listagem deve informar o uso de assentos à UI');
});

test('a migration do ciclo 6 cria as colunas e é idempotente', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle6.sql'), 'utf8');
  for (const col of ['user_seats', 'is_protected', 'must_change_password', 'last_login_at', 'password_changed_at']) {
    assert.match(sql, new RegExp(col), `migration deve criar ${col}`);
  }
  const alters = sql.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];
  const idempotentes = sql.match(/ADD COLUMN IF NOT EXISTS/g) || [];
  assert.equal(alters.length, idempotentes.length, 'todo ADD COLUMN precisa de IF NOT EXISTS');

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migrations', 'manifest.json'), 'utf8'));
  assert.ok(manifest.migrations.includes('create_locacore_cycle6.sql'), 'migration deve estar no manifest');

  const rollback = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'create_locacore_cycle6_rollback.sql'), 'utf8');
  for (const col of ['user_seats', 'is_protected', 'must_change_password']) {
    assert.match(rollback, new RegExp(col), `rollback deve remover ${col}`);
  }
});
