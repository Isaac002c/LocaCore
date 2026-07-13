const pool = require('../config/db');

// ============================================
// SERVICE BILLINGS MODEL (faturamento por processo/serviço)
// Todas as queries são tenant-scoped.
// ============================================

const SELECT_BASE = `
  SELECT b.*,
         c.name  AS client_name,
         c.cpf   AS client_cpf,
         f.fine_number AS fine_number,
         f.plate       AS fine_plate,
         st.label      AS service_label
    FROM service_billings b
    LEFT JOIN clients c        ON b.client_id = c.id
    LEFT JOIN fines f          ON b.fine_id = f.id
    LEFT JOIN service_types st ON b.service_type_id = st.id
`;

const createBilling = async (data) => {
  const {
    tenant_id, client_id, company_id, fine_id, service_type_id, description,
    original_amount, discount, surcharge, final_amount, paid_amount,
    installments, due_date, payment_method, financial_status, notes, created_by,
  } = data;

  const { rows } = await pool.query(
    `INSERT INTO service_billings (
       tenant_id, client_id, company_id, fine_id, service_type_id, description,
       original_amount, discount, surcharge, final_amount, paid_amount,
       installments, due_date, payment_method, financial_status, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      tenant_id, client_id || null, company_id || null, fine_id || null,
      service_type_id || null, description || null,
      original_amount, discount, surcharge, final_amount, paid_amount || 0,
      installments || 1, due_date || null, payment_method || null,
      financial_status, notes || null, created_by || null,
    ]
  );
  return rows[0];
};

const listBillings = async (tenant_id, filters = {}) => {
  const {
    client_id, fine_id, financial_status, payment_method,
    date_from, date_to, search,
    limit = 20, offset = 0, sort = 'created_at', order = 'desc',
  } = filters;

  const where = ['b.tenant_id = $1'];
  const params = [tenant_id];
  let i = 2;
  if (client_id)        { where.push(`b.client_id = $${i++}`); params.push(client_id); }
  if (fine_id)          { where.push(`b.fine_id = $${i++}`); params.push(fine_id); }
  if (financial_status) { where.push(`b.financial_status = $${i++}`); params.push(financial_status); }
  if (payment_method)   { where.push(`b.payment_method = $${i++}`); params.push(payment_method); }
  if (date_from)        { where.push(`b.created_at::date >= $${i++}`); params.push(date_from); }
  if (date_to)          { where.push(`b.created_at::date <= $${i++}`); params.push(date_to); }
  if (search)           { where.push(`(c.name ILIKE $${i} OR b.description ILIKE $${i})`); params.push(`%${search}%`); i++; }

  const whereSql = where.join(' AND ');

  const allowedSort = { created_at: 'b.created_at', due_date: 'b.due_date', final_amount: 'b.final_amount', status: 'b.financial_status' };
  const sortCol = allowedSort[sort] || 'b.created_at';
  const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM service_billings b
       LEFT JOIN clients c ON b.client_id = c.id
     WHERE ${whereSql}`,
    params
  );

  const dataRes = await pool.query(
    `${SELECT_BASE} WHERE ${whereSql}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, Math.min(parseInt(limit, 10) || 20, 100), parseInt(offset, 10) || 0]
  );

  return { rows: dataRes.rows, total: totalRes.rows[0].total };
};

// Indicadores agregados respeitando os MESMOS filtros da listagem
// (para os cards do topo da tela de Faturamentos).
const getBillingStats = async (tenant_id, filters = {}) => {
  const { client_id, fine_id, financial_status, payment_method, date_from, date_to, search } = filters;
  const where = ['b.tenant_id = $1'];
  const params = [tenant_id];
  let i = 2;
  if (client_id)        { where.push(`b.client_id = $${i++}`); params.push(client_id); }
  if (fine_id)          { where.push(`b.fine_id = $${i++}`); params.push(fine_id); }
  if (financial_status) { where.push(`b.financial_status = $${i++}`); params.push(financial_status); }
  if (payment_method)   { where.push(`b.payment_method = $${i++}`); params.push(payment_method); }
  if (date_from)        { where.push(`b.created_at::date >= $${i++}`); params.push(date_from); }
  if (date_to)          { where.push(`b.created_at::date <= $${i++}`); params.push(date_to); }
  if (search)           { where.push(`(c.name ILIKE $${i} OR b.description ILIKE $${i})`); params.push(`%${search}%`); i++; }

  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN b.financial_status <> 'cancelado' THEN b.final_amount ELSE 0 END), 0) AS faturado,
        COALESCE(SUM(CASE WHEN b.financial_status <> 'cancelado' THEN b.paid_amount ELSE 0 END), 0) AS recebido,
        COALESCE(SUM(CASE WHEN b.financial_status IN ('faturado','parcialmente_pago','vencido')
          THEN b.final_amount - b.paid_amount ELSE 0 END), 0) AS pendente,
        COALESCE(SUM(CASE WHEN b.financial_status = 'vencido'
             OR (b.financial_status IN ('faturado','parcialmente_pago')
                 AND b.due_date IS NOT NULL AND b.due_date < CURRENT_DATE)
          THEN b.final_amount - b.paid_amount ELSE 0 END), 0) AS vencido,
        COUNT(CASE WHEN b.financial_status <> 'cancelado' THEN 1 END)::int AS total_count
       FROM service_billings b
       LEFT JOIN clients c ON b.client_id = c.id
      WHERE ${where.join(' AND ')}`,
    params
  );
  return rows[0];
};

const getBillingById = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE b.id = $1 AND b.tenant_id = $2`,
    [id, tenant_id]
  );
  return rows[0];
};

// Atualização de campos manuais do faturamento (não mexe em paid_amount).
const updateBilling = async (id, data, tenant_id) => {
  const {
    description, original_amount, discount, surcharge, final_amount,
    installments, due_date, payment_method, financial_status, notes,
    service_type_id, fine_id, client_id, company_id,
  } = data;

  const { rows } = await pool.query(
    `UPDATE service_billings SET
        description     = $1,
        original_amount = COALESCE($2, original_amount),
        discount        = COALESCE($3, discount),
        surcharge       = COALESCE($4, surcharge),
        final_amount    = COALESCE($5, final_amount),
        installments    = COALESCE($6, installments),
        due_date        = $7,
        payment_method  = $8,
        financial_status= COALESCE($9, financial_status),
        notes           = $10,
        service_type_id = COALESCE($11, service_type_id),
        fine_id         = COALESCE($12, fine_id),
        client_id       = COALESCE($13, client_id),
        company_id      = COALESCE($14, company_id),
        updated_at      = NOW()
     WHERE id = $15 AND tenant_id = $16 RETURNING *`,
    [
      description ?? null, original_amount ?? null, discount ?? null, surcharge ?? null,
      final_amount ?? null, installments ?? null, due_date || null, payment_method || null,
      financial_status || null, notes ?? null, service_type_id || null, fine_id || null,
      client_id || null, company_id || null, id, tenant_id,
    ]
  );
  return rows[0];
};

const cancelBilling = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `UPDATE service_billings
       SET financial_status = 'cancelado', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenant_id]
  );
  return rows[0];
};

const getBillingsByClient = async (client_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE b.client_id = $1 AND b.tenant_id = $2 ORDER BY b.created_at DESC`,
    [client_id, tenant_id]
  );
  return rows;
};

const getBillingsByFine = async (fine_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE b.fine_id = $1 AND b.tenant_id = $2 ORDER BY b.created_at DESC`,
    [fine_id, tenant_id]
  );
  return rows;
};

// Resumo financeiro agregado — reutilizável para cliente e processo.
// CASE WHEN (e não FILTER) por portabilidade — mesmo padrão do código legado.
const _summary = async (column, id, tenant_id) => {
  const { rows } = await pool.query(
    `SELECT
        COUNT(CASE WHEN financial_status <> 'cancelado' THEN 1 END)::int AS total_billings,
        COALESCE(SUM(CASE WHEN financial_status <> 'cancelado' THEN final_amount ELSE 0 END), 0) AS total_billed,
        COALESCE(SUM(CASE WHEN financial_status <> 'cancelado' THEN paid_amount ELSE 0 END), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN financial_status NOT IN ('cancelado','pago') THEN final_amount - paid_amount ELSE 0 END), 0) AS total_pending
     FROM service_billings
     WHERE ${column} = $1 AND tenant_id = $2`,
    [id, tenant_id]
  );
  return rows[0];
};

const getClientSummary = (client_id, tenant_id) => _summary('client_id', client_id, tenant_id);
const getFineSummary = (fine_id, tenant_id) => _summary('fine_id', fine_id, tenant_id);

// Agregados de faturamento para o dashboard financeiro (mês corrente).
const getBillingDashboard = async (tenant_id, { monthStart, monthEnd }) => {
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN financial_status <> 'cancelado'
            AND created_at::date >= $2 AND created_at::date <= $3
          THEN final_amount ELSE 0 END), 0) AS faturamento_mes,
        COUNT(CASE WHEN financial_status = 'pago' THEN 1 END)::int AS servicos_pagos,
        COUNT(CASE WHEN financial_status IN ('faturado','parcialmente_pago','vencido') THEN 1 END)::int AS servicos_pendentes,
        COALESCE(SUM(CASE WHEN financial_status IN ('faturado','parcialmente_pago','vencido')
          THEN final_amount - paid_amount ELSE 0 END), 0) AS total_pendente,
        COALESCE(SUM(CASE WHEN financial_status = 'vencido'
             OR (financial_status IN ('faturado','parcialmente_pago')
                 AND due_date IS NOT NULL AND due_date < CURRENT_DATE)
          THEN final_amount - paid_amount ELSE 0 END), 0) AS total_vencido
     FROM service_billings
     WHERE tenant_id = $1`,
    [tenant_id, monthStart, monthEnd]
  );
  return rows[0];
};

module.exports = {
  createBilling,
  listBillings,
  getBillingStats,
  getBillingById,
  updateBilling,
  cancelBilling,
  getBillingsByClient,
  getBillingsByFine,
  getClientSummary,
  getFineSummary,
  getBillingDashboard,
};
