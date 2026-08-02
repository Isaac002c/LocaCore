'use strict';
// =============================================================================
// LOCACORE — Ciclo 7: base de cobrança (Asaas customer) + adapter fiscal real
// (Focus NFe) + correção do phone_number_id do WhatsApp por-tenant.
//
// Adapters testados com HTTP INJETADO (sem rede). A sincronização de customer é
// testada de ponta a ponta em pg-mem (idempotência + persistência do mapeamento).
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

const { asaasProvider } = require('../services/automation/providers/payment');
const { focusNfeProvider, validateConfig } = require('../services/automation/providers/fiscal');
const { metaProvider } = require('../services/automation/providers/whatsapp');

const secrets = { FISCAL_FOCUSNFE_TOKEN: 'ftok', META_WHATSAPP_ACCESS_TOKEN: 'tok', META_APP_SECRET: 'sec' };
const secretFn = (scope, name) => secrets[`${scope}_${name}`.toUpperCase()];

const NFSE_SETTINGS = {
  fiscal_provider: 'focusnfe', fiscal_document_type: 'nfse',
  fiscal_config: { cnpj: '12.345.678/0001-90', inscricao_municipal: '99', municipio: '3550308', regime_tributario: 'simples', codigo_servico: '3.05', aliquota: 3 },
};

// ── Asaas: createCustomer ────────────────────────────────────────────────────
test('Asaas: createCustomer envia cpfCnpj só com dígitos e devolve o id', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ id: 'cus_123' }) }; };
  const p = asaasProvider({ secretFn: (s, n) => ({ PAYMENT_ASAAS_KEY: 'k' }[`${s}_${n}`.toUpperCase()]), fetchImpl });
  const r = await p.createCustomer({ name: 'Maria', cpfCnpj: '123.456.789-09', email: 'm@x.com', phone: '(21) 99999-8888' });
  assert.equal(r.external_id, 'cus_123');
  assert.ok(calls[0].url.endsWith('/customers'));
  assert.equal(calls[0].body.cpfCnpj, '12345678909');
  assert.equal(calls[0].body.mobilePhone, '21999998888');
});

test('Asaas: createCustomer sem CPF/CNPJ falha com clareza', async () => {
  const p = asaasProvider({ secretFn: (s, n) => ({ PAYMENT_ASAAS_KEY: 'k' }[`${s}_${n}`.toUpperCase()]), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  await assert.rejects(() => p.createCustomer({ name: 'Sem Doc' }), /CPF\/CNPJ/);
});

// ── Focus NFe (fiscal real) ──────────────────────────────────────────────────
test('validateConfig: NFS-e exige codigo_servico e aliquota', () => {
  assert.equal(validateConfig(NFSE_SETTINGS).ok, true);
  const semCodigo = { ...NFSE_SETTINGS, fiscal_config: { ...NFSE_SETTINGS.fiscal_config, codigo_servico: '' } };
  assert.ok(validateConfig(semCodigo).missing.includes('codigo_servico'));
  const semAliquota = { ...NFSE_SETTINGS, fiscal_config: { ...NFSE_SETTINGS.fiscal_config, aliquota: '' } };
  assert.ok(validateConfig(semAliquota).missing.includes('aliquota'));
});

test('Focus NFe: issueDocument monta a NFS-e e trata emissão assíncrona (202 → processing)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, method: opts.method, body: JSON.parse(opts.body), auth: opts.headers.Authorization }); return { status: 202, json: async () => ({ status: 'processando_autorizacao' }) }; };
  const p = focusNfeProvider({ secretFn, fetchImpl, base: 'https://homologacao.focusnfe.com.br' });
  const client = { name: 'Maria', cpf: '12345678909', email: 'm@x.com' };
  const r = await p.issueDocument({ ref: 'doc-1', amount: 700, document_type: 'nfse', client, settings: NFSE_SETTINGS });
  assert.equal(r.status, 'processing');
  assert.equal(r.external_id, 'doc-1');
  // requisição correta
  assert.ok(calls[0].url.includes('/v2/nfse?ref=doc-1'));
  assert.equal(calls[0].body.prestador.cnpj, '12345678000190');
  assert.equal(calls[0].body.tomador.cpf, '12345678909');
  assert.equal(calls[0].body.servico.valor_servicos, 700);
  assert.equal(calls[0].body.servico.item_lista_servico, '3.05');
  assert.ok(calls[0].auth.startsWith('Basic '));
});

test('Focus NFe: getDocumentStatus mapeia autorizado com número e PDF', async () => {
  const p = focusNfeProvider({ secretFn, fetchImpl: async () => ({ status: 200, json: async () => ({ status: 'autorizado', numero: '2025/123', codigo_verificacao: 'ABC', url: 'http://pdf', caminho_xml_nota_fiscal: '/x.xml' }) }), base: 'x' });
  const r = await p.getDocumentStatus({ ref: 'doc-1' });
  assert.equal(r.status, 'authorized');
  assert.equal(r.number, '2025/123');
  assert.equal(r.verification_code, 'ABC');
  assert.equal(r.pdf_url, 'http://pdf');
});

test('Focus NFe: erro de autorização vira status error com a mensagem', async () => {
  const p = focusNfeProvider({ secretFn, fetchImpl: async () => ({ status: 422, json: async () => ({ status: 'erro_autorizacao', erros: [{ mensagem: 'Código de serviço inválido' }] }) }), base: 'x' });
  const r = await p.issueDocument({ ref: 'doc-2', amount: 100, document_type: 'nfse', client: { cpf: '1' }, settings: NFSE_SETTINGS });
  assert.equal(r.status, 'error');
  assert.match(r.error_message, /Código de serviço inválido/);
});

test('Focus NFe: sem credenciais → pending_configuration (não inventa nota)', async () => {
  const p = focusNfeProvider({ secretFn: () => null, fetchImpl: async () => ({ status: 200, json: async () => ({}) }), base: 'x' });
  const r = await p.issueDocument({ ref: 'd', amount: 1, document_type: 'nfse', client: {}, settings: NFSE_SETTINGS });
  assert.equal(r.status, 'pending_configuration');
});

test('Focus NFe: NF-e ainda não mapeada → pendência explícita (não emite errado)', async () => {
  const p = focusNfeProvider({ secretFn, fetchImpl: async () => ({ status: 200, json: async () => ({}) }), base: 'x' });
  const r = await p.issueDocument({ ref: 'd', amount: 1, document_type: 'nfe', client: {}, settings: { ...NFSE_SETTINGS, fiscal_document_type: 'nfe' } });
  assert.equal(r.status, 'pending_configuration');
  assert.equal(r.error_code, 'NFE_NOT_MAPPED');
});

// ── WhatsApp: phone_number_id por-tenant (correção do bug de env) ─────────────
test('WhatsApp Meta: usa o phone_number_id das settings do tenant (whatsapp_from)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url }); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) }; };
  const p = metaProvider({ secretFn, fetchImpl, settings: { whatsapp_from: '55999' } });
  await p.sendTemplateMessage({ to: '5521999', provider_template_id: 'cobranca', variables: { valor: 'R$ 700' } });
  assert.ok(calls[0].url.includes('/55999/messages'), `esperava o phone do tenant na URL: ${calls[0].url}`);
});

// ── ensurePaymentCustomer (pg-mem): idempotente e persiste o mapeamento ───────
let ensurePaymentCustomer, pool, clienteId;
before(async () => {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });
  db.public.none(`
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT, cpf TEXT, email TEXT, phone TEXT );
    CREATE TABLE payment_customers ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, provider TEXT NOT NULL, client_id UUID NOT NULL, external_customer_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT uq_payment_customers UNIQUE (tenant_id, provider, client_id) );
  `);
  pool = new (db.adapters.createPg().Pool)();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;
  ({ ensurePaymentCustomer } = require('../services/automation/paymentCustomers'));
  clienteId = (await pool.query(`INSERT INTO clients (tenant_id,name,cpf,email) VALUES ('t','Maria','12345678909','m@x.com') RETURNING id`)).rows[0].id;
});

test('ensurePaymentCustomer: cria uma vez e reusa o mapeamento (idempotente)', async () => {
  let creates = 0;
  const provider = { name: 'asaas', isSandbox: false, async createCustomer({ cpfCnpj }) { creates++; assert.equal(cpfCnpj, '12345678909'); return { external_id: 'cus_9' }; } };
  const id1 = await ensurePaymentCustomer('t', provider, { client_id: clienteId });
  const id2 = await ensurePaymentCustomer('t', provider, { client_id: clienteId });
  assert.equal(id1, 'cus_9');
  assert.equal(id2, 'cus_9');
  assert.equal(creates, 1, 'só cria o customer UMA vez; a segunda cobrança reusa');
});

test('ensurePaymentCustomer: sandbox é no-op (não cria customer)', async () => {
  const provider = { name: 'null', isSandbox: true, createCustomer() { throw new Error('não deveria chamar'); } };
  assert.equal(await ensurePaymentCustomer('t', provider, { client_id: clienteId }), null);
});
