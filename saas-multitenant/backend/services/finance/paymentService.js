// =============================================================================
// paymentService.js — Orquestração transacional de pagamentos.
//
// Regras (dentro de UMA transação de banco):
//   Confirmar pagamento:
//     1. Bloqueia o faturamento (FOR UPDATE) e valida o saldo.
//     2. Registra o pagamento.
//     3. Recalcula o total pago e o saldo do faturamento.
//     4. Atualiza o status financeiro.
//     5. Cria automaticamente UMA entrada no Caixa (idempotente por payment_id).
//     6. Vincula a entrada ao pagamento, cliente e processo.
//   Cancelar pagamento:
//     - Recalcula faturamento, cancela (estorna logicamente) a entrada, preserva histórico.
//
// Depende de um `repo` injetável (produção: financeRepo; testes: repo em memória).
// =============================================================================

const { createDbRepo } = require('./financeRepo');
const {
  ValidationError, toCents, computeBalanceCents, deriveBillingStatus,
} = require('./calc');

class NotFoundError extends Error {
  constructor(message) { super(message); this.name = 'NotFoundError'; this.statusCode = 404; }
}

// Confirma (registra) um pagamento.
async function confirmPayment(input, repo = createDbRepo()) {
  const amountCents = toCents(input.amount);
  if (amountCents <= 0) throw new ValidationError('Valor do pagamento deve ser maior que zero');
  if (!input.tenant_id) throw new ValidationError('tenant_id é obrigatório');

  return repo.withTransaction(async (tx) => {
    let billing = null;

    if (input.billing_id) {
      billing = await tx.getBillingForUpdate(input.billing_id, input.tenant_id);
      if (!billing) throw new NotFoundError('Faturamento não encontrado');
      if (billing.financial_status === 'cancelado') {
        throw new ValidationError('Não é possível pagar um faturamento cancelado');
      }
      const balanceCents = computeBalanceCents({
        finalAmount: billing.final_amount, paidAmount: billing.paid_amount,
      });
      if (!input.allowOverpay && amountCents > balanceCents) {
        throw new ValidationError('Valor do pagamento maior que o saldo pendente do faturamento');
      }
      // Herda cliente/processo do faturamento quando não informados explicitamente.
      if (!input.client_id) input.client_id = billing.client_id;
      if (!input.fine_id)   input.fine_id = billing.fine_id;
    }

    const payment = await tx.insertPayment({
      tenant_id: input.tenant_id,
      billing_id: input.billing_id || null,
      client_id: input.client_id || null,
      fine_id: input.fine_id || null,
      amount: input.amount,
      payment_date: input.payment_date || null,
      payment_method: input.payment_method || null,
      installment_number: input.installment_number || 1,
      installments_total: input.installments_total || 1,
      is_deposit: input.is_deposit || false,
      notes: input.notes || null,
      created_by: input.created_by || null,
    });

    let updatedBilling = billing;
    if (billing) {
      const newPaid = await tx.sumConfirmedPayments(input.billing_id, input.tenant_id);
      const status = deriveBillingStatus({
        finalAmount: billing.final_amount, paidAmount: newPaid,
        dueDate: billing.due_date, canceled: false,
      });
      updatedBilling = await tx.updateBillingPaid(input.billing_id, input.tenant_id, newPaid, status);
    }

    // Entrada automática no Caixa (idempotente: 1 entrada por pagamento).
    const entry = await tx.insertPaymentEntryIfAbsent({
      tenant_id: input.tenant_id,
      category_id: input.category_id || null,
      description: input.entry_description || 'Recebimento de pagamento',
      amount: input.amount,
      transaction_date: input.payment_date || null,
      payment_method: input.payment_method || null,
      client_id: input.client_id || null,
      fine_id: input.fine_id || null,
      billing_id: input.billing_id || null,
      payment_id: payment.id,
      created_by: input.created_by || null,
    });

    return { payment, billing: updatedBilling, transaction: entry };
  });
}

// Cancela um pagamento (estorno lógico). Preserva o histórico.
async function cancelPayment(paymentId, input, repo = createDbRepo()) {
  if (!paymentId) throw new ValidationError('paymentId é obrigatório');
  if (!input || !input.tenant_id) throw new ValidationError('tenant_id é obrigatório');

  return repo.withTransaction(async (tx) => {
    const payment = await tx.getPaymentForUpdate(paymentId, input.tenant_id);
    if (!payment) throw new NotFoundError('Pagamento não encontrado');
    if (payment.status === 'cancelado') {
      throw new ValidationError('Pagamento já está cancelado');
    }

    const canceled = await tx.cancelPaymentRow(paymentId, input.tenant_id, input.reason);

    let updatedBilling = null;
    if (payment.billing_id) {
      const billing = await tx.getBillingForUpdate(payment.billing_id, input.tenant_id);
      if (billing && billing.financial_status !== 'cancelado') {
        const newPaid = await tx.sumConfirmedPayments(payment.billing_id, input.tenant_id);
        const status = deriveBillingStatus({
          finalAmount: billing.final_amount, paidAmount: newPaid,
          dueDate: billing.due_date, canceled: false,
        });
        updatedBilling = await tx.updateBillingPaid(payment.billing_id, input.tenant_id, newPaid, status);
      }
    }

    // Estorna (cancela logicamente) a entrada de Caixa vinculada.
    const entry = await tx.cancelPaymentEntry(paymentId, input.tenant_id);

    return { payment: canceled, billing: updatedBilling, transaction: entry };
  });
}

module.exports = { confirmPayment, cancelPayment, NotFoundError };
