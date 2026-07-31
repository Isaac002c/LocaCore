'use strict';
// =============================================================================
// SESSÃO E TROCA OBRIGATÓRIA DE SENHA — fluxo ponta a ponta por HTTP.
//
// Regressão que motivou esta suíte:
//   `iat` do JWT é em SEGUNDOS inteiros; `sessions_valid_after` é timestamptz
//   com MILISSEGUNDOS. A comparação `iat*1000 < sessions_valid_after` recusava
//   um token RECÉM-EMITIDO e legítimo quando o login acontecia no mesmo segundo
//   da invalidação: o login devolvia 200 e a requisição seguinte, 401.
//
// Sobe login + tenantContext + uma rota protegida reais sobre pg-mem.
// =============================================================================
process.env.JWT_SECRET = 'test-secret-sessao';
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';
process.env.NODE_ENV = 'test';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let server, base, pool, permissionModel, tenantContext;
const T = 'tenant-rental-log';
let usuario;

const SENHA_INICIAL = 'Provisoria-123';

before(async () => {
  const db = newDb({ noAstCoverageCheck: true });
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.registerFunction({ name: 'now', returns: DataType.timestamptz, impure: true, implementation: () => new Date() });
  db.public.none(`
    CREATE TABLE tenants (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, status TEXT DEFAULT 'ativo',
      modules JSONB, user_seats INT NOT NULL DEFAULT 4,
      logo_url TEXT, brand_color TEXT, brand_color_dark TEXT, tagline TEXT
    );
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
      name TEXT, email TEXT, password_hash TEXT, role TEXT DEFAULT 'viewer',
      is_active BOOLEAN DEFAULT TRUE, sessions_valid_after TIMESTAMPTZ,
      is_protected BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      last_login TIMESTAMPTZ, last_login_at TIMESTAMPTZ, password_changed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  permissionModel = require('../models/permissionModels');
  tenantContext = require('../middlewares/tenantContext');
  const authRoutes = require('../routes/authRoutes');

  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/auth', authRoutes);
  app.use('/api', tenantContext);
  // Sonda no lugar das rotas de relatório: mesma proteção, sem depender do schema.
  app.get('/api/reports/overview', (req, res) => res.json({ success: true, tenant: req.tenantId }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

beforeEach(async () => {
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM tenants');
  await pool.query(
    `INSERT INTO tenants (id,name,slug,status,modules) VALUES ($1,'Rental Log','rental-log','ativo','["locacao","financeiro"]')`,
    [T],
  );
  usuario = await permissionModel.createUser({
    tenant_id: T, name: 'Leandro', email: 'leandro@ex.com',
    password: SENHA_INICIAL, role: 'admin',
  });
  tenantContext.invalidateAuthCache();
});

const login = async (email, password) => {
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};

const relatorio = async (token) => {
  const r = await fetch(`${base}/api/reports/overview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, erro: j.error || null };
};

// ── Login ───────────────────────────────────────────────────────────────────
test('login válido devolve token e dados do tenant', async () => {
  const r = await login('leandro@ex.com', SENHA_INICIAL);
  assert.equal(r.status, 200);
  assert.ok(r.token, 'deve devolver token');
  assert.equal(r.user.email, 'leandro@ex.com');
  assert.equal(r.tenant.name, 'Rental Log');
  assert.deepEqual(r.tenant.modules, ['locacao', 'financeiro']);
});

test('login com senha errada → 401 e sem token', async () => {
  const r = await login('leandro@ex.com', 'senha-errada');
  assert.equal(r.status, 401);
  assert.equal(r.token, undefined);
});

test('login com e-mail inexistente → 401', async () => {
  const r = await login('ninguem@ex.com', SENHA_INICIAL);
  assert.equal(r.status, 401);
});

test('login é insensível a maiúsculas no e-mail', async () => {
  const r = await login('LEANDRO@ex.com', SENHA_INICIAL);
  assert.equal(r.status, 200, 'normalizeEmail deve permitir o e-mail em caixa alta');
});

test('usuário desativado não entra', async () => {
  await permissionModel.setUserActive(usuario.id, false, T);
  const r = await login('leandro@ex.com', SENHA_INICIAL);
  assert.equal(r.status, 403);
});

// ── Troca obrigatória ───────────────────────────────────────────────────────
test('senha criada por admin nasce provisória e o login sinaliza a troca', async () => {
  const r = await login('leandro@ex.com', SENHA_INICIAL);
  assert.equal(r.status, 200);
  assert.equal(r.user.must_change_password, true, 'o frontend usa isto para bloquear o sistema');
});

test('após definir a própria senha, o login não exige mais troca', async () => {
  await permissionModel.updateUserPassword(usuario.id, 'Minha-Senha-Nova-9', T);
  const r = await login('leandro@ex.com', 'Minha-Senha-Nova-9');
  assert.equal(r.status, 200);
  assert.equal(r.user.must_change_password, false);
});

// ── Token e rotas protegidas ────────────────────────────────────────────────
test('relatórios SEM token → 401', async () => {
  const r = await relatorio(null);
  assert.equal(r.status, 401);
  assert.match(r.erro, /Token não fornecido/);
});

test('relatórios com token adulterado → 401', async () => {
  const { token } = await login('leandro@ex.com', SENHA_INICIAL);
  const r = await relatorio(`${token.slice(0, -4)}xxxx`);
  assert.equal(r.status, 401);
});

test('relatórios COM token recém-emitido → 200', async () => {
  const { token } = await login('leandro@ex.com', SENHA_INICIAL);
  const r = await relatorio(token);
  assert.equal(r.status, 200);
});

test('o mesmo token continua valendo em requisições seguintes (reload da página)', async () => {
  const { token } = await login('leandro@ex.com', SENHA_INICIAL);
  for (let i = 0; i < 3; i += 1) {
    const r = await relatorio(token);
    assert.equal(r.status, 200, `requisição ${i + 1} deveria continuar autenticada`);
  }
});

// ── Invalidação de sessão ───────────────────────────────────────────────────
test('token ANTIGO é rejeitado depois da troca de senha', async () => {
  const { token: antigo } = await login('leandro@ex.com', SENHA_INICIAL);
  assert.equal((await relatorio(antigo)).status, 200);

  // Token emitido um minuto antes da invalidação (sem depender do relógio real).
  const passado = Math.floor(Date.now() / 1000) - 60;
  const tokenVelho = jwt.sign(
    { userId: usuario.id, tenantId: T, email: 'leandro@ex.com', role: 'admin', iat: passado },
    process.env.JWT_SECRET,
  );

  await permissionModel.updateUserPassword(usuario.id, 'Outra-Senha-2026', T);
  tenantContext.invalidateAuthCache();

  const r = await relatorio(tokenVelho);
  assert.equal(r.status, 401);
  assert.match(r.erro, /Sessão expirada/);
});

test('token NOVO, emitido após a troca, funciona', async () => {
  await permissionModel.updateUserPassword(usuario.id, 'Outra-Senha-2026', T);
  tenantContext.invalidateAuthCache();

  const r = await login('leandro@ex.com', 'Outra-Senha-2026');
  assert.equal(r.status, 200);
  assert.equal((await relatorio(r.token)).status, 200);
});

test('REGRESSÃO: trocar a senha e logar no MESMO segundo mantém a sessão válida', async () => {
  // Era o bug: sessions_valid_after tem milissegundos e o `iat` é truncado para
  // o segundo, então o token novo parecia "anterior" à invalidação.
  for (let i = 0; i < 8; i += 1) {
    const senha = `Rodada-Numero-${i}`;
    await permissionModel.updateUserPassword(usuario.id, senha, T);
    tenantContext.invalidateAuthCache();

    const r = await login('leandro@ex.com', senha);
    assert.equal(r.status, 200, `rodada ${i}: login deveria funcionar`);

    const rel = await relatorio(r.token);
    assert.equal(rel.status, 200, `rodada ${i}: token recém-emitido não pode ser recusado (${rel.erro})`);
  }
});

test('REGRESSÃO: comparação usa a MESMA resolução (segundos) dos dois lados', async () => {
  // Invalidação com fração de segundo: um token do mesmo segundo deve passar.
  const agora = new Date();
  const comFracao = new Date(Math.floor(agora.getTime() / 1000) * 1000 + 700);
  await pool.query('UPDATE users SET sessions_valid_after = $1 WHERE id = $2', [comFracao, usuario.id]);
  tenantContext.invalidateAuthCache();

  const iatMesmoSegundo = Math.floor(comFracao.getTime() / 1000);
  const token = jwt.sign(
    { userId: usuario.id, tenantId: T, email: 'leandro@ex.com', role: 'admin', iat: iatMesmoSegundo },
    process.env.JWT_SECRET,
  );
  assert.equal((await relatorio(token)).status, 200, 'mesmo segundo da invalidação: deve valer');

  // E um token de um segundo ANTES continua bloqueado.
  const tokenAnterior = jwt.sign(
    { userId: usuario.id, tenantId: T, email: 'leandro@ex.com', role: 'admin', iat: iatMesmoSegundo - 1 },
    process.env.JWT_SECRET,
  );
  assert.equal((await relatorio(tokenAnterior)).status, 401, 'segundo anterior: deve ser bloqueado');
});

test('desativar o usuário derruba a sessão na hora (cache invalidado)', async () => {
  const { token } = await login('leandro@ex.com', SENHA_INICIAL);
  assert.equal((await relatorio(token)).status, 200);

  await permissionModel.setUserActive(usuario.id, false, T);
  tenantContext.invalidateAuthCache();

  const r = await relatorio(token);
  assert.equal(r.status, 401);
  assert.match(r.erro, /desativado/i);
});

test('as rotas de usuário limpam o cache de acesso após senha/desativar/excluir', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'userManagementRoutes.js'), 'utf8');
  assert.match(src, /invalidateAuthCache/, 'as rotas devem invalidar o cache');
  assert.equal((src.match(/invalidateAuthCache\(id\)/g) || []).length, 3,
    'senha, ativar/desativar e excluir devem invalidar');
});

test('o middleware continua exigindo tenantId no token', async () => {
  const semTenant = jwt.sign({ userId: usuario.id, email: 'leandro@ex.com', role: 'admin' }, process.env.JWT_SECRET);
  const r = await relatorio(semTenant);
  assert.equal(r.status, 401);
  assert.match(r.erro, /Tenant inválido/);
});
