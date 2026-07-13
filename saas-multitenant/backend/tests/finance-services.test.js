'use strict';
// Testes de orquestração (pagamentos/recibos) com repositório EM MEMÓRIA.
// Testa recálculo, entrada automática única, idempotência, cancelamento,
// numeração de recibo, isolamento por tenant e rollback — tudo sem banco real.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const paymentService = require('../services/finance/paymentService');
const receiptService = require('../services/finance/receiptService');

// ── Repositório em memória (implementa a mesma interface de financeRepo) ──────
function createMemoryRepo(seed = {}) {
  const state = {
    billings: seed.billings || [],
    payments: [],
    transactions: [],
    settings: seed.settings || [],
    receipts: [],
    seq: { pay: 0, tx: 0, rec: 0 },
    throwAt: seed.throwAt || null, // nome do método que deve lançar (teste de rollback)
  };

  function makeTx(s) {
    const maybeThrow = (name) => { if (s.throwAt === name) throw new Error(`boom@${name}`); };
    return {
      async getBillingForUpdate(id, tenant) {
        maybeThrow('getBillingForUpdate');
        const b = s.billings.find((x) => x.id === id && x.tenant_id === tenant);
        return b ? { ...b } : null;
      },
      async sumConfirmedPayments(billingId, tenant) {
        return s.payments
          .filter((p) => p.billing_id === billingId && p.tenant_id === tenant && p.status === 'confirmado')
          .reduce((a, p) => a + Number(p.amount), 0);
      },
      async updateBillingPaid(id, tenant, paid, status) {
        maybeThrow('updateBillingPaid');
        const b = s.billings.find((x) => x.id === id && x.tenant_id === tenant);
        b.paid_amount = paid; b.financial_status = status;
        return { ...b };
      },
      async insertPayment(data) {
        maybeThrow('insertPayment');
        const row = { id: `pay-${++s.seq.pay}`, status: 'confirmado', ...data };
        s.payments.push(row);
        return { ...row };
      },
      async getPaymentForUpdate(id, tenant) {
        const p = s.payments.find((x) => x.id === id && x.tenant_id === tenant);
        return p ? { ...p } : null;
      },
      async cancelPaymentRow(id, tenant, reason) {
        const p = s.payments.find((x) => x.id === id && x.tenant_id === tenant && x.status === 'confirmado');
        if (!p) return null;
        p.status = 'cancelado'; p.cancel_reason = reason || null;
        return { ...p };
      },
      async insertPaymentEntryIfAbsent(data) {
        maybeThrow('insertPaymentEntryIfAbsent');
        if (s.transactions.some((t) => t.payment_id === data.payment_id)) return null; // idempotência
        const row = { id: `tx-${++s.seq.tx}`, type: 'entrada', status: 'recebido', origin: 'pagamento', ...data };
        s.transactions.push(row);
        return { ...row };
      },
      async cancelPaymentEntry(paymentId, tenant) {
        const t = s.transactions.find((x) => x.payment_id === paymentId && x.tenant_id === tenant && x.status !== 'cancelado');
        if (!t) return null;
        t.status = 'cancelado';
        return { ...t };
      },
      async getPayment(id, tenant) {
        const p = s.payments.find((x) => x.id === id && x.tenant_id === tenant);
        return p ? { ...p } : null;
      },
      async getActiveReceiptByPayment(paymentId, tenant) {
        const r = s.receipts.find((x) => x.payment_id === paymentId && x.tenant_id === tenant && x.status === 'emitido');
        return r ? { ...r } : null;
      },
      async ensureSettingsForUpdate(tenant, prefix) {
        let st = s.settings.find((x) => x.tenant_id === tenant);
        if (!st) { st = { tenant_id: tenant, receipt_prefix: prefix || 'NEXO', last_receipt_number: 0 }; s.settings.push(st); }
        return { ...st };
      },
      async bumpReceiptNumber(tenant) {
        const st = s.settings.find((x) => x.tenant_id === tenant);
        st.last_receipt_number += 1;
        return { number: st.last_receipt_number, prefix: st.receipt_prefix };
      },
      async insertReceipt(data) {
        if (s.receipts.some((r) => r.tenant_id === data.tenant_id && r.number === data.number)) {
          throw new Error('duplicate receipt number'); // simula UNIQUE(tenant_id, number)
        }
        const row = { id: `rec-${++s.seq.rec}`, status: 'emitido', ...data };
        s.receipts.push(row);
        return { ...row };
      },
      async getReceiptForUpdate(id, tenant) {
        const r = s.receipts.find((x) => x.id === id && x.tenant_id === tenant);
        return r ? { ...r } : null;
      },
      async cancelReceiptRow(id, tenant, reason) {
        const r = s.receipts.find((x) => x.id === id && x.tenant_id === tenant && x.status === 'emitido');
        if (!r) return null;
        r.status = 'cancelado'; r.cancel_reason = reason || null;
        return { ...r };
      },
    };
  }

  return {
    _state: state,
    async withTransaction(fn) {
      const working = structuredClone({
        billings: state.billings, payments: state.payments, transactions: state.transactions,
        settings: state.settings, receipts: state.receipts, seq: state.seq,
      });
      working.throwAt = state.throwAt;
      const tx = makeTx(working);
      const result = await fn(tx);        // se lançar, NÃO commita (rollback)
      state.billings = working.billings;
      state.payments = working.payments;
      state.transactions = working.transactions;
      state.settings = working.settings;
      state.receipts = working.receipts;
      state.seq = working.seq;
      return result;
    },
  };
}

const T = 'tenant-A';
const billing = () => ({
  id: 'bill-1', tenant_id: T, client_id: 'cli-1', fine_id: 'fine-1',
  final_amount: 1000, paid_amount: 0, financial_status: 'faturado', due_date: null,
});

// ── Pagamentos ───────────────────────────────────────────────────────────────
test('pagamento parcial atualiza pago/saldo/status e cria 1 entrada', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  const r = await paymentService.confirmPayment(
    { tenant_id: T, billing_id: 'bill-1', amount: 300, payment_method: 'pix', category_id: 'cat-1' }, repo);
  assert.equal(r.billing.paid_amount, 300);
  assert.equal(r.billing.financial_status, 'parcialmente_pago');
  assert.equal(repo._state.transactions.length, 1);
  assert.equal(r.transaction.type, 'entrada');
  assert.equal(r.transaction.payment_id, r.payment.id);
  assert.equal(r.transaction.client_id, 'cli-1'); // herdado do faturamento
});

test('pagamento total marca faturamento como pago', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  const r = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 1000 }, repo);
  assert.equal(r.billing.financial_status, 'pago');
  assert.equal(r.billing.paid_amount, 1000);
});

test('dois pagamentos parciais somam corretamente', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 400 }, repo);
  const r2 = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 600 }, repo);
  assert.equal(r2.billing.paid_amount, 1000);
  assert.equal(r2.billing.financial_status, 'pago');
  assert.equal(repo._state.transactions.length, 2);
});

test('rejeita pagamento acima do saldo', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  await assert.rejects(
    () => paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 1500 }, repo),
    /maior que o saldo/);
  assert.equal(repo._state.payments.length, 0); // nada persistido
});

test('permite overpay explícito', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  const r = await paymentService.confirmPayment(
    { tenant_id: T, billing_id: 'bill-1', amount: 1500, allowOverpay: true }, repo);
  assert.equal(r.billing.paid_amount, 1500);
});

test('idempotência: mesmo payment_id não gera duas entradas', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  await repo.withTransaction(async (tx) => {
    const a = await tx.insertPaymentEntryIfAbsent({ tenant_id: T, payment_id: 'pay-X', amount: 100 });
    const b = await tx.insertPaymentEntryIfAbsent({ tenant_id: T, payment_id: 'pay-X', amount: 100 });
    assert.ok(a);
    assert.equal(b, null);
  });
  assert.equal(repo._state.transactions.length, 1);
});

test('cancelar pagamento recalcula faturamento e estorna a entrada', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  const r = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 1000 }, repo);
  const c = await paymentService.cancelPayment(r.payment.id, { tenant_id: T, reason: 'engano' }, repo);
  assert.equal(c.payment.status, 'cancelado');
  assert.equal(c.billing.paid_amount, 0);
  assert.equal(c.billing.financial_status, 'faturado');
  assert.equal(c.transaction.status, 'cancelado');   // estorno lógico
  assert.equal(repo._state.transactions.length, 1);  // preservada, não apagada
});

test('isolamento por tenant: faturamento de outro tenant não é encontrado', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  await assert.rejects(
    () => paymentService.confirmPayment({ tenant_id: 'tenant-B', billing_id: 'bill-1', amount: 100 }, repo),
    /não encontrado/);
});

test('rollback: erro após inserir pagamento não persiste nada', async () => {
  const repo = createMemoryRepo({ billings: [billing()], throwAt: 'insertPaymentEntryIfAbsent' });
  await assert.rejects(
    () => paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 500 }, repo));
  assert.equal(repo._state.payments.length, 0);
  assert.equal(repo._state.billings[0].paid_amount, 0);
});

// ── Recibos ──────────────────────────────────────────────────────────────────
async function seedPaidBilling() {
  const repo = createMemoryRepo({ billings: [billing()] });
  const p1 = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 500 }, repo);
  const p2 = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 500 }, repo);
  return { repo, p1: p1.payment, p2: p2.payment };
}

test('emite recibo com número sequencial NEXO-000001', async () => {
  const { repo, p1 } = await seedPaidBilling();
  const rec = await receiptService.issueReceipt(
    { tenant_id: T, payment_id: p1.id, client_name: 'João', amount: 500, defaultIssuerName: 'Nexo' }, repo);
  assert.equal(rec.number, 1);
  assert.equal(rec.full_number, 'NEXO-000001');
  assert.equal(rec.issuer_name, 'Nexo');
  assert.equal(rec.status, 'emitido');
});

test('numeração incrementa por tenant e é única', async () => {
  const { repo, p1, p2 } = await seedPaidBilling();
  const r1 = await receiptService.issueReceipt({ tenant_id: T, payment_id: p1.id }, repo);
  const r2 = await receiptService.issueReceipt({ tenant_id: T, payment_id: p2.id }, repo);
  assert.equal(r1.full_number, 'NEXO-000001');
  assert.equal(r2.full_number, 'NEXO-000002');
});

test('bloqueia segundo recibo ativo para o mesmo pagamento', async () => {
  const { repo, p1 } = await seedPaidBilling();
  await receiptService.issueReceipt({ tenant_id: T, payment_id: p1.id }, repo);
  await assert.rejects(
    () => receiptService.issueReceipt({ tenant_id: T, payment_id: p1.id }, repo),
    /recibo ativo/);
});

test('cancelar recibo preserva no histórico', async () => {
  const { repo, p1 } = await seedPaidBilling();
  const rec = await receiptService.issueReceipt({ tenant_id: T, payment_id: p1.id }, repo);
  const c = await receiptService.cancelReceipt(rec.id, { tenant_id: T, reason: 'erro' }, repo);
  assert.equal(c.status, 'cancelado');
  assert.equal(repo._state.receipts.length, 1); // não apagado
});

test('reemitir cancela o antigo e emite novo número', async () => {
  const { repo, p1 } = await seedPaidBilling();
  const rec = await receiptService.issueReceipt({ tenant_id: T, payment_id: p1.id }, repo);
  const re = await receiptService.reissueReceipt(rec.id, { tenant_id: T }, repo);
  assert.equal(re.full_number, 'NEXO-000002');
  const old = repo._state.receipts.find((r) => r.id === rec.id);
  assert.equal(old.status, 'cancelado');
  assert.equal(re.status, 'emitido');
});

test('não emite recibo de pagamento cancelado', async () => {
  const repo = createMemoryRepo({ billings: [billing()] });
  const r = await paymentService.confirmPayment({ tenant_id: T, billing_id: 'bill-1', amount: 500 }, repo);
  await paymentService.cancelPayment(r.payment.id, { tenant_id: T }, repo);
  await assert.rejects(
    () => receiptService.issueReceipt({ tenant_id: T, payment_id: r.payment.id }, repo),
    /cancelado/);
});
