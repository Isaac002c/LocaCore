'use strict';
// Testes HTTP reais de autenticação/permissão/isolamento por tenant.
// Sobem um servidor Express com o tenantContext e as rotas financeiras REAIS.
// Casos 401/403/validação NÃO tocam o banco (curto-circuito antes do handler).
process.env.JWT_SECRET = 'test-secret-http';
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const tenantContext = require('../middlewares/tenantContext');
const { requireFinanceRead } = require('../middlewares/financeAccess');
const financialRoutes = require('../routes/financialRoutes');

let server, base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', tenantContext);
  // Rota-sonda: reflete o tenant efetivo (vindo do token) após os guards.
  app.get('/api/probe', requireFinanceRead, (req, res) => res.json({ ok: true, tenant: req.tenantId }));
  app.use('/api/financial', financialRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

const tok = (role, tenantId = 'tenant-1') =>
  jwt.sign({ userId: 'u1', tenantId, email: 'a@b.c', role }, process.env.JWT_SECRET);

const call = (path, { token, method = 'GET', body } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('sem token → 401', async () => {
  const r = await call('/api/financial/categories');
  assert.equal(r.status, 401);
});

test('token inválido → 401', async () => {
  const r = await call('/api/financial/categories', { token: 'lixo.invalido' });
  assert.equal(r.status, 401);
});

test('consultor (seller) → 403 no financeiro', async () => {
  const r = await call('/api/probe', { token: tok('seller') });
  assert.equal(r.status, 403);
});

test('super_admin → 403 (não acessa financeiro do tenant)', async () => {
  const r = await call('/api/probe', { token: tok('super_admin') });
  assert.equal(r.status, 403);
});

test('admin → 200 e tenant vem do TOKEN', async () => {
  const r = await call('/api/probe', { token: tok('admin', 'tenant-XYZ') });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tenant, 'tenant-XYZ');
});

test('tenant_id no payload é IGNORADO (usa o do token)', async () => {
  // Mesmo enviando outro tenant_id, o backend usa o do token na sonda.
  const r = await call('/api/probe?tenant_id=tenant-HACKER', { token: tok('admin', 'tenant-REAL') });
  const j = await r.json();
  assert.equal(j.tenant, 'tenant-REAL');
});

test('consultor não cria lançamento → 403 (antes do banco)', async () => {
  const r = await call('/api/financial/transactions', { token: tok('seller'), method: 'POST', body: { type: 'entrada', amount: 10 } });
  assert.equal(r.status, 403);
});

test('admin com payload inválido → 400 (validação antes do banco)', async () => {
  const r = await call('/api/financial/transactions', { token: tok('admin'), method: 'POST', body: { type: 'xxx', amount: 10 } });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /Tipo inválido/);
});

test('consultor não emite recibo → 403', async () => {
  const r = await call('/api/financial/receipts', { token: tok('seller'), method: 'POST', body: { payment_id: 'x' } });
  assert.equal(r.status, 403);
});

test('overview (dashboard financeiro) bloqueado para consultor e super_admin → 403', async () => {
  const a = await call('/api/financial/summary/overview?preset=month', { token: tok('seller') });
  assert.equal(a.status, 403);
  const b = await call('/api/financial/summary/overview?preset=month', { token: tok('super_admin') });
  assert.equal(b.status, 403);
});

test('billings/stats bloqueado sem permissão → 403', async () => {
  const r = await call('/api/financial/billings/stats', { token: tok('seller') });
  assert.equal(r.status, 403);
});
