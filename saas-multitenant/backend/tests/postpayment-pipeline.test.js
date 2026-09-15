'use strict';

// Pipeline pós-pagamento (§6/§8/§9/§25/§32/§45/§48/§49): recibo antes da data de
// obrigatoriedade, NFS-e a partir dela, envio do documento e confirmação manual.
// Os modelos/serviços de folha são substituídos por dublês em require.cache, de
// modo que o teste exercita a ORQUESTRAÇÃO real sem banco.

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';
process.env.BASE_URL = 'https://locacore.example';
process.env.AUTOMATION_SECRETS_KEY = 'chave-de-teste-para-assinar-links';

const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(relPath, exportsObj) {
  const id = require.resolve(relPath);
  const m = new Module(id);
  m.filename = id; m.loaded = true; m.exports = exportsObj;
  require.cache[id] = m;
  return exportsObj;
}

const state = {};
function reset() {
  state.outbox = [];
  state.audits = [];
  state.receipts = [];
  state.fiscalCalls = [];
  state.confirmCalls = [];
  state.chargePatches = [];
  state.remindersCancelled = [];
  state.settings = { receipts_enabled: true, whatsapp_enabled: true };
  state.existingReceipt = null;
  state.existingConfirmed = [];
  state.fiscalResult = { id: 'fdoc1', status: 'authorized', number: 'NFSE-846', pdf_url: 'https://fiscal.example/nfse/846.pdf' };
  state.charge = {
    id: 'chg1', tenant_id: 't1', billing_id: 'b1', rental_id: 'r1', client_id: 'c1',
    public_id: 'COB-2026-000001', amount: '700.00', status: 'waiting_payment',
  };
}
reset();

let pipeline; let paymentConfirm; let publicLinks;

before(() => {
  stub('../models/automationModels', {
    getSettings: async () => state.settings,
    getActiveTemplate: async () => null,
    insertOutbox: async (row) => { state.outbox.push(row); return { created: true, row: { id: 'msg1', ...row } }; },
    getChargeForUpdate: async () => (state.charge ? { ...state.charge } : null),
    updateCharge: async (_id, _t, patch) => { state.chargePatches.push(patch); return { ...state.charge, ...patch }; },
    cancelRemindersForCharge: async (_t, id) => { state.remindersCancelled.push(id); return []; },
  });
  stub('../models/paymentModels', {
    getPaymentById: async (id) => ({ id, amount: '700.00', billing_id: 'b1', client_id: 'c1', payment_method: 'pix', payment_date: '2026-08-20', status: 'confirmado' }),
    getPaymentsByBilling: async () => state.existingConfirmed,
  });
  stub('../models/serviceBillingModels', {
    getBillingById: async (id) => ({ id, rental_id: 'r1', client_id: 'c1', period_start: '2026-08-17', period_end: '2026-08-23' }),
  });
  stub('../models/rentalModels', {
    getRentalById: async (id) => ({ id, rental_number: 'LOC-000001', client_name: 'João', client_phone: '5521999998888', vehicle_plate: 'ABC1D23', start_date: '2026-08-17', end_date: '2026-08-23', client_id: 'c1', vehicle_id: 'v1' }),
  });
  stub('../models/clientModels', { getClientById: async (id) => ({ id, name: 'João', cpf: '12345678909' }) });
  stub('../models/receiptModels', { getActiveReceiptByPayment: async () => state.existingReceipt });
  stub('../models/tenantModels', { getTenantById: async () => ({ slug: 't1' }) });
  stub('../services/finance/receiptService', {
    issueReceipt: async (input) => {
      const r = { id: `rec${state.receipts.length + 1}`, full_number: `REC-00${state.receipts.length + 1}`, ...input };
      state.existingReceipt = r; state.receipts.push(r); return r;
    },
  });
  stub('../services/finance/paymentService', {
    confirmPayment: async (input) => { state.confirmCalls.push(input); const p = { id: 'pay1', amount: input.amount, billing_id: input.billing_id, client_id: 'c1', status: 'confirmado', payment_date: input.payment_date, payment_method: input.payment_method }; state.existingConfirmed = [p]; return { payment: p }; },
    NotFoundError: class NotFoundError extends Error {},
  });
  stub('../services/finance/financeRepo', { createDbRepo: () => ({}) });
  stub('../services/automation/fiscalService', {
    issueForPayment: async (_t, pid, opts) => { state.fiscalCalls.push({ pid, opts }); return state.fiscalResult; },
  });
  stub('../services/automation/auditService', { record: async (a) => { state.audits.push(a); } });
  stub('../services/automation/secretStore', { getSecrets: async () => ({}), resolver: () => () => null });
  stub('../services/automation/providers/payment', { getPaymentProvider: () => ({}) });
  stub('../services/activityLogService', { logGeneric: async () => {} });

  pipeline = require('../services/automation/postPaymentPipeline');
  paymentConfirm = require('../services/automation/paymentConfirmService');
  publicLinks = require('../services/automation/publicLinks');
});

beforeEach(() => reset());

// ── resolveDocumentKind (pura) — o coração da regra do contador ───────────────
test('antes de nfse_mandatory_from gera RECIBO; a partir da data, NFS-e', () => {
  const base = { receipts_enabled: true, nfse_enabled: true, fiscal_enabled: true, fiscal_mode: 'after_payment', nfse_mandatory_from: '2026-12-01', billing_timezone: 'America/Sao_Paulo' };
  assert.equal(pipeline.resolveDocumentKind(base, { now: new Date('2026-08-20T13:00:00Z') }), 'receipt');
  assert.equal(pipeline.resolveDocumentKind(base, { now: new Date('2026-11-30T13:00:00Z') }), 'receipt');
  assert.equal(pipeline.resolveDocumentKind(base, { now: new Date('2026-12-01T13:00:00Z') }), 'nfse');
  assert.equal(pipeline.resolveDocumentKind(base, { now: new Date('2027-03-01T13:00:00Z') }), 'nfse');
});

test('NFS-e preparada mas não ativada (nfse_enabled=false) mantém recibo', () => {
  const s = { receipts_enabled: true, nfse_enabled: false, fiscal_enabled: true, nfse_mandatory_from: '2026-01-01', fiscal_mode: 'after_payment', billing_timezone: 'America/Sao_Paulo' };
  assert.equal(pipeline.resolveDocumentKind(s, { now: new Date('2026-08-20T13:00:00Z') }), 'receipt');
});

test('sem flags de documento não gera nada; NFS-e em modo != after_payment não vira recibo', () => {
  assert.equal(pipeline.resolveDocumentKind({}, {}), 'none');
  assert.equal(pipeline.resolveDocumentKind({ nfse_enabled: true, fiscal_enabled: true, fiscal_mode: 'on_charge', receipts_enabled: true, nfse_mandatory_from: '2020-01-01' }, {}), 'none');
});

test('a virada de data respeita o fuso do tenant (23:30 em SP ainda é o dia anterior)', () => {
  const s = { nfse_enabled: true, fiscal_enabled: true, receipts_enabled: true, fiscal_mode: 'after_payment', nfse_mandatory_from: '2026-12-01', billing_timezone: 'America/Sao_Paulo' };
  // 2026-12-01T02:00Z == 2026-11-30 23:00 em São Paulo → ainda recibo.
  assert.equal(pipeline.resolveDocumentKind(s, { now: new Date('2026-12-01T02:00:00Z') }), 'receipt');
  // 2026-12-01T13:00Z == 2026-12-01 10:00 em São Paulo → NFS-e.
  assert.equal(pipeline.resolveDocumentKind(s, { now: new Date('2026-12-01T13:00:00Z') }), 'nfse');
});

// ── publicLinks — capability URL assinada ────────────────────────────────────
test('link público de recibo é assinado e à prova de adulteração', () => {
  const link = publicLinks.receiptLink('t1', 'rec1');
  assert.match(link, /^https:\/\/locacore\.example\/public\/documents\/receipt\/rec1\?tid=t1&t=[a-f0-9]{32}$/);
  const token = new URL(link).searchParams.get('t');
  assert.equal(publicLinks.verify('receipt', 't1', 'rec1', token), true);
  assert.equal(publicLinks.verify('receipt', 't1', 'rec2', token), false, 'outro id não valida');
  assert.equal(publicLinks.verify('receipt', 'outro', 'rec1', token), false, 'outro tenant não valida');
  assert.equal(publicLinks.verify('receipt', 't1', 'rec1', `${token.slice(0, -1)}0`), false, 'token adulterado');
});

// ── runForPayment — recibo real + envio do documento ─────────────────────────
test('recibo: pagamento confirmado gera recibo e enfileira o documento com link', async () => {
  const out = await pipeline.runForPayment('t1', {
    payment_id: 'pay1', settings: { receipts_enabled: true, whatsapp_enabled: true, document_auto_send: true, billing_timezone: 'America/Sao_Paulo' },
    now: new Date('2026-08-20T13:00:00Z'),
  });
  assert.equal(out.kind, 'receipt');
  assert.equal(state.receipts.length, 1);
  assert.equal(out.document.tipo, 'Recibo');
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].template_kind, 'document');
  assert.match(state.outbox[0].body, /REC-001/);
  assert.match(state.outbox[0].body, /public\/documents\/receipt/);
  assert.equal(state.outbox[0].idempotency_key, 'pay1:document');
});

test('idempotência: com recibo ativo existente não emite outro', async () => {
  state.existingReceipt = { id: 'recX', full_number: 'REC-099' };
  const out = await pipeline.runForPayment('t1', {
    payment_id: 'pay1', settings: { receipts_enabled: true, whatsapp_enabled: true, billing_timezone: 'America/Sao_Paulo' },
    now: new Date('2026-08-20T13:00:00Z'),
  });
  assert.equal(state.receipts.length, 0, 'não chamou issueReceipt');
  assert.equal(out.document.numero, 'REC-099');
});

test('NFS-e: a partir da data emite nota (não recibo) via fiscalService', async () => {
  const out = await pipeline.runForPayment('t1', {
    payment_id: 'pay1', settings: { receipts_enabled: true, nfse_enabled: true, fiscal_enabled: true, fiscal_mode: 'after_payment', nfse_mandatory_from: '2026-12-01', whatsapp_enabled: true, billing_timezone: 'America/Sao_Paulo' },
    now: new Date('2026-12-10T13:00:00Z'),
  });
  assert.equal(out.kind, 'nfse');
  assert.equal(state.fiscalCalls.length, 1);
  assert.equal(state.receipts.length, 0);
  assert.equal(out.document.tipo, 'NFS-e');
});

test('sem WhatsApp habilitado, gera recibo mas não enfileira mensagem', async () => {
  const out = await pipeline.runForPayment('t1', {
    payment_id: 'pay1', settings: { receipts_enabled: true, whatsapp_enabled: false, billing_timezone: 'America/Sao_Paulo' },
    now: new Date('2026-08-20T13:00:00Z'),
  });
  assert.equal(out.kind, 'receipt');
  assert.equal(state.receipts.length, 1);
  assert.equal(state.outbox.length, 0);
});

// ── confirmManual (§49) — mesmo pipeline do webhook ──────────────────────────
test('confirmação manual: confirma o pagamento, dá baixa na cobrança e roda o MESMO pipeline', async () => {
  const out = await paymentConfirm.confirmManual('t1', 'chg1', {
    amount: '700.00', payment_date: '2026-08-20', payment_method: 'pix', notes: 'no caixa', created_by: 'user1',
  });
  assert.equal(state.confirmCalls.length, 1, 'reusou o fluxo financeiro real');
  assert.equal(state.confirmCalls[0].billing_id, 'b1');
  assert.ok(state.chargePatches.some((p) => p.status === 'paid'), 'cobrança vira paid');
  assert.deepEqual(state.remindersCancelled, ['chg1'], 'cancela lembretes futuros');
  assert.equal(state.receipts.length, 1, 'gerou recibo pelo pipeline');
  assert.equal(out.kind, 'receipt');
});

test('confirmação manual preserva o pagamento e devolve o bloqueio fiscal exato', async () => {
  state.settings = {
    receipts_enabled: false, nfse_enabled: true, fiscal_enabled: true,
    fiscal_mode: 'after_payment', nfse_mandatory_from: '2026-01-01',
    whatsapp_enabled: false, billing_timezone: 'America/Sao_Paulo',
  };
  state.fiscalResult = {
    id: 'fdoc1', status: 'pending_configuration',
    error_code: 'NATIONAL_TAX_CODE_PENDING_NT009',
    error_message: 'Código 99.04.01 ainda indisponível na Plataforma Nacional.',
  };
  const out = await paymentConfirm.confirmManual('t1', 'chg1', {
    amount: '700.00', payment_date: '2026-08-20', payment_method: 'pix', created_by: 'user1',
  });
  assert.ok(state.chargePatches.some((p) => p.status === 'paid'));
  assert.equal(out.kind, 'nfse');
  assert.equal(out.fiscal_status, 'pending_configuration');
  assert.equal(out.fiscal_error_code, 'NATIONAL_TAX_CODE_PENDING_NT009');
  assert.match(out.fiscal_error_message, /99\.04\.01/);
});

test('piloto pode enviar somente cobrança e não manda confirmação/documento após recebido', async () => {
  state.settings = {
    receipts_enabled: true,
    whatsapp_enabled: true,
    document_auto_send: false,
    whatsapp_config: { send_payment_confirmation: false },
  };
  const out = await paymentConfirm.confirmManual('t1', 'chg1', {
    amount: '700.00', payment_date: '2026-08-20', payment_method: 'pix', created_by: 'user1',
  });
  assert.equal(out.kind, 'receipt');
  assert.equal(state.receipts.length, 1, 'o documento continua sendo gerado e arquivado');
  assert.equal(state.outbox.length, 0, 'nenhuma mensagem pós-pagamento é enviada');
});

test('confirmação manual falha com 409 quando a cobrança não tem faturamento', async () => {
  state.charge = { id: 'chg2', tenant_id: 't1', billing_id: null, status: 'waiting_payment' };
  await assert.rejects(
    () => paymentConfirm.confirmManual('t1', 'chg2', { amount: '700.00' }),
    (err) => err.statusCode === 409,
  );
});
