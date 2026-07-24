'use strict';
// =============================================================================
// C5 — Usuários (§9/§10): desativação invalida sessões (sessions_valid_after),
// redefinição de senha também invalida sessões, e estado de acesso é isolado
// por tenant. Não valida hash aqui (bcrypt já coberto); foca no controle de acesso.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, users;
const T = 't1', T2 = 't2';
let u1;

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
      name TEXT, email TEXT, password_hash TEXT, role TEXT DEFAULT 'viewer',
      is_active BOOLEAN DEFAULT TRUE, sessions_valid_after TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  users = require('../models/permissionModels');
  u1 = await users.createUser({ tenant_id: T, name: 'Op', email: 'op@x.com', password: 'segredo123', role: 'operator' });
  await users.createUser({ tenant_id: T2, name: 'Outro', email: 'op@x.com', password: 'segredo123', role: 'admin' });
});

test('cria usuário ativo por padrão e estado de acesso reflete ativo', async () => {
  const st = await users.getUserAuthState(u1.id, T);
  assert.equal(st.is_active, true);
  assert.equal(st.sessions_valid_after, null, 'sem reset de sessão ainda');
});

test('desativar define is_active=false e sessions_valid_after (encerra sessões)', async () => {
  const before = Date.now();
  const r = await users.setUserActive(u1.id, false, T);
  assert.equal(r.is_active, false);
  const st = await users.getUserAuthState(u1.id, T);
  assert.equal(st.is_active, false);
  assert.ok(st.sessions_valid_after, 'sessions_valid_after preenchido');
  assert.ok(new Date(st.sessions_valid_after).getTime() >= before - 1000, 'timestamp recente');
});

test('reativar mantém acesso; nova redefinição de senha invalida sessões novamente', async () => {
  await users.setUserActive(u1.id, true, T);
  const before = Date.now();
  const upd = await users.updateUserPassword(u1.id, 'novaSenha456', T);
  assert.ok(upd && upd.id, 'senha atualizada');
  const st = await users.getUserAuthState(u1.id, T);
  assert.equal(st.is_active, true, 'segue ativo');
  assert.ok(new Date(st.sessions_valid_after).getTime() >= before - 1000, 'sessão invalidada pela troca de senha');
});

test('estado de acesso é isolado por tenant (mesmo e-mail, tenants distintos)', async () => {
  // u1 pertence a T; consultar em T2 não retorna nada.
  const cross = await users.getUserAuthState(u1.id, T2);
  assert.equal(cross, undefined, 'usuário de T não é visível em T2');
  // desativar u1 não afeta o usuário homônimo de T2
  const others = await users.getUsersWithRoles(T2);
  assert.equal(others.length, 1);
  assert.equal(others[0].is_active, true, 'usuário de T2 permanece ativo');
});
