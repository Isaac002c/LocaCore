const pool = require('../config/db');

// ============================================
// FINANCE REPORT MODELS — consultas agregadas para o Dashboard Financeiro.
// Todas tenant-scoped; SQL portável (Postgres real e pg-mem): agrupa por data
// bruta e o bucketing dia/semana/mês é feito em services/finance/reporting.js.
// ============================================

// Fluxo de caixa: total por data e tipo (exclui cancelados).
const getCashflowByDate = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT transaction_date AS d, type, SUM(amount) AS total
       FROM financial_transactions
      WHERE tenant_id = $1 AND status <> 'cancelado'
        AND transaction_date >= $2 AND transaction_date <= $3
      GROUP BY transaction_date, type`,
    [tenant_id, start, end]
  );
  return rows;
};

// Faturamentos criados por data (valor final e pago — snapshot atual).
// Sem GROUP BY por expressão (portabilidade): uma linha por faturamento; a
// agregação por bucket é feita em services/finance/reporting.js (backend).
const getBilledByDate = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT created_at AS d, final_amount AS total, paid_amount AS paid
       FROM service_billings
      WHERE tenant_id = $1 AND financial_status <> 'cancelado'
        AND created_at::date >= $2 AND created_at::date <= $3`,
    [tenant_id, start, end]
  );
  return rows;
};

// Pagamentos confirmados por data.
const getReceivedByDate = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT payment_date AS d, SUM(amount) AS total
       FROM payments
      WHERE tenant_id = $1 AND status = 'confirmado'
        AND payment_date >= $2 AND payment_date <= $3
      GROUP BY payment_date`,
    [tenant_id, start, end]
  );
  return rows;
};

// Distribuição por status financeiro (faturamentos do período).
const getStatusDistribution = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT financial_status AS status, COUNT(*)::int AS count, COALESCE(SUM(final_amount),0) AS total
       FROM service_billings
      WHERE tenant_id = $1
        AND created_at::date >= $2 AND created_at::date <= $3
      GROUP BY financial_status`,
    [tenant_id, start, end]
  );
  return rows
    .map((r) => ({ status: r.status, count: r.count, total: Number(r.total) || 0 }))
    .sort((a, b) => b.total - a.total);
};

// Receita por tipo de serviço (faturamentos não cancelados do período).
// GROUP BY por colunas simples (portável); rótulo/ordenação resolvidos em JS.
const getRevenueByService = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT st.label AS label, st.code AS code, COALESCE(SUM(b.final_amount),0) AS total,
            COUNT(*)::int AS count
       FROM service_billings b
       LEFT JOIN service_types st ON b.service_type_id = st.id
      WHERE b.tenant_id = $1 AND b.financial_status <> 'cancelado'
        AND b.created_at::date >= $2 AND b.created_at::date <= $3
      GROUP BY st.label, st.code`,
    [tenant_id, start, end]
  );
  return rows
    .map((r) => ({ service: r.label || r.code || 'Sem serviço', total: Number(r.total) || 0, count: r.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);
};

// Distribuição por forma de pagamento (pagamentos confirmados do período).
const getPaymentMethodDistribution = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT payment_method AS method, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS total
       FROM payments
      WHERE tenant_id = $1 AND status = 'confirmado'
        AND payment_date >= $2 AND payment_date <= $3
      GROUP BY payment_method`,
    [tenant_id, start, end]
  );
  return rows
    .map((r) => ({ method: r.method || 'outro', count: r.count, total: Number(r.total) || 0 }))
    .sort((a, b) => b.total - a.total);
};

// Entradas e saídas por categoria (lançamentos não cancelados do período).
const getCategoryBreakdown = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT c.name AS name, t.type AS type, COALESCE(SUM(t.amount),0) AS total
       FROM financial_transactions t
       LEFT JOIN financial_categories c ON t.category_id = c.id
      WHERE t.tenant_id = $1 AND t.status <> 'cancelado'
        AND t.transaction_date >= $2 AND t.transaction_date <= $3
      GROUP BY c.name, t.type`,
    [tenant_id, start, end]
  );
  return rows
    .map((r) => ({ category: r.name || 'Sem categoria', type: r.type, total: Number(r.total) || 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 16);
};

// KPIs de faturamento do período (snapshot): faturado, pago, pendente, vencido,
// contagens e ticket médio. CASE WHEN por portabilidade.
const getBillingKpis = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN financial_status <> 'cancelado' THEN final_amount ELSE 0 END), 0) AS faturado,
        COUNT(CASE WHEN financial_status <> 'cancelado' THEN 1 END)::int AS count_faturados,
        COUNT(CASE WHEN financial_status = 'pago' THEN 1 END)::int AS count_pagos,
        COALESCE(SUM(CASE WHEN financial_status IN ('faturado','parcialmente_pago','vencido')
          THEN final_amount - paid_amount ELSE 0 END), 0) AS pendente,
        COALESCE(SUM(CASE WHEN financial_status = 'vencido'
             OR (financial_status IN ('faturado','parcialmente_pago')
                 AND due_date IS NOT NULL AND due_date < CURRENT_DATE)
          THEN final_amount - paid_amount ELSE 0 END), 0) AS vencido
       FROM service_billings
      WHERE tenant_id = $1
        AND created_at::date >= $2 AND created_at::date <= $3`,
    [tenant_id, start, end]
  );
  return rows[0];
};

// Total recebido no período (pagamentos confirmados).
const getReceivedTotal = async (tenant_id, { start, end }) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count
       FROM payments
      WHERE tenant_id = $1 AND status = 'confirmado'
        AND payment_date >= $2 AND payment_date <= $3`,
    [tenant_id, start, end]
  );
  return rows[0];
};

module.exports = {
  getCashflowByDate,
  getBilledByDate,
  getReceivedByDate,
  getStatusDistribution,
  getRevenueByService,
  getPaymentMethodDistribution,
  getCategoryBreakdown,
  getBillingKpis,
  getReceivedTotal,
};
