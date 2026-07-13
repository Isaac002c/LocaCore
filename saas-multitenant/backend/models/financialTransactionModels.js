const pool = require('../config/db');

// ============================================
// FINANCIAL TRANSACTIONS MODEL (lançamentos / Caixa)
// Todas as queries são tenant-scoped. Agregações feitas no banco (não no front).
// ============================================

const SELECT_BASE = `
  SELECT t.*,
         cat.name AS category_name,
         cat.type AS category_type,
         c.name   AS client_name,
         f.fine_number AS fine_number,
         u.name   AS created_by_name
    FROM financial_transactions t
    LEFT JOIN financial_categories cat ON t.category_id = cat.id
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN fines f   ON t.fine_id = f.id
    LEFT JOIN users u   ON t.created_by = u.id
`;

// Constrói a cláusula WHERE compartilhada entre lista e agregados.
function buildWhere(tenant_id, filters = {}) {
  const {
    type, category_id, status, payment_method, client_id, fine_id,
    date_from, date_to,
  } = filters;
  const where = ['t.tenant_id = $1'];
  const params = [tenant_id];
  let i = 2;
  if (type)           { where.push(`t.type = $${i++}`); params.push(type); }
  if (category_id)    { where.push(`t.category_id = $${i++}`); params.push(category_id); }
  if (status)         { where.push(`t.status = $${i++}`); params.push(status); }
  if (payment_method) { where.push(`t.payment_method = $${i++}`); params.push(payment_method); }
  if (client_id)      { where.push(`t.client_id = $${i++}`); params.push(client_id); }
  if (fine_id)        { where.push(`t.fine_id = $${i++}`); params.push(fine_id); }
  if (date_from)      { where.push(`t.transaction_date >= $${i++}`); params.push(date_from); }
  if (date_to)        { where.push(`t.transaction_date <= $${i++}`); params.push(date_to); }
  return { whereSql: where.join(' AND '), params, nextIndex: i };
}

const listTransactions = async (tenant_id, filters = {}) => {
  const { limit = 20, offset = 0, sort = 'transaction_date', order = 'desc' } = filters;
  const { whereSql, params, nextIndex } = buildWhere(tenant_id, filters);
  let i = nextIndex;

  const allowedSort = {
    transaction_date: 't.transaction_date', due_date: 't.due_date',
    amount: 't.amount', created_at: 't.created_at', status: 't.status',
  };
  const sortCol = allowedSort[sort] || 't.transaction_date';
  const sortDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM financial_transactions t WHERE ${whereSql}`,
    params
  );
  const dataRes = await pool.query(
    `${SELECT_BASE} WHERE ${whereSql} ORDER BY ${sortCol} ${sortDir}, t.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, Math.min(parseInt(limit, 10) || 20, 200), parseInt(offset, 10) || 0]
  );
  return { rows: dataRes.rows, total: totalRes.rows[0].total };
};

// Resumo do caixa para o conjunto filtrado (ex.: uma semana).
// CASE WHEN (e não FILTER) por portabilidade — mesmo padrão do código legado.
const getSummary = async (tenant_id, filters = {}) => {
  const { whereSql, params } = buildWhere(tenant_id, filters);
  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN type = 'entrada' AND status <> 'cancelado' THEN amount ELSE 0 END), 0) AS total_entradas,
        COALESCE(SUM(CASE WHEN type = 'saida'   AND status <> 'cancelado' THEN amount ELSE 0 END), 0) AS total_saidas,
        COALESCE(SUM(CASE WHEN type = 'entrada' AND status IN ('pago','recebido') THEN amount ELSE 0 END), 0) AS recebidos,
        COALESCE(SUM(CASE WHEN status IN ('previsto','pendente') THEN amount ELSE 0 END), 0) AS pendentes,
        COALESCE(SUM(CASE WHEN status = 'vencido'
             OR (status IN ('previsto','pendente') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)
           THEN amount ELSE 0 END), 0) AS vencidos,
        COUNT(CASE WHEN status <> 'cancelado' THEN 1 END)::int AS total_count
     FROM financial_transactions t
     WHERE ${whereSql}`,
    params
  );
  const r = rows[0];
  r.saldo = Number(r.total_entradas) - Number(r.total_saidas);
  return r;
};

const getTransactionById = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE t.id = $1 AND t.tenant_id = $2`, [id, tenant_id]
  );
  return rows[0];
};

const getTransactionsByClient = async (client_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE t.client_id = $1 AND t.tenant_id = $2 ORDER BY t.transaction_date DESC`,
    [client_id, tenant_id]
  );
  return rows;
};

const getTransactionsByFine = async (fine_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE t.fine_id = $1 AND t.tenant_id = $2 ORDER BY t.transaction_date DESC`,
    [fine_id, tenant_id]
  );
  return rows;
};

const createTransaction = async (data) => {
  const {
    tenant_id, type, category_id, description, amount, transaction_date,
    due_date, payment_method, status, client_id, fine_id, billing_id,
    payment_id, origin, created_by, notes,
  } = data;
  const { rows } = await pool.query(
    `INSERT INTO financial_transactions (
       tenant_id, type, category_id, description, amount, transaction_date,
       due_date, payment_method, status, client_id, fine_id, billing_id,
       payment_id, origin, created_by, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      tenant_id, type, category_id || null, description || null, amount,
      transaction_date || null, due_date || null, payment_method || null,
      status || 'pago', client_id || null, fine_id || null, billing_id || null,
      payment_id || null, origin || 'manual', created_by || null, notes || null,
    ]
  );
  return rows[0];
};

// Só permite editar lançamentos manuais (origin='manual') e não cancelados.
const updateTransaction = async (id, data, tenant_id) => {
  const {
    type, category_id, description, amount, transaction_date, due_date,
    payment_method, status, client_id, fine_id, notes,
  } = data;
  const { rows } = await pool.query(
    `UPDATE financial_transactions SET
        type = COALESCE($1, type),
        category_id = COALESCE($2, category_id),
        description = $3,
        amount = COALESCE($4, amount),
        transaction_date = COALESCE($5, transaction_date),
        due_date = $6,
        payment_method = $7,
        status = COALESCE($8, status),
        client_id = $9,
        fine_id = $10,
        notes = $11,
        updated_at = NOW()
     WHERE id = $12 AND tenant_id = $13 AND origin = 'manual' AND status <> 'cancelado'
     RETURNING *`,
    [
      type || null, category_id || null, description ?? null, amount ?? null,
      transaction_date || null, due_date || null, payment_method || null,
      status || null, client_id || null, fine_id || null, notes ?? null, id, tenant_id,
    ]
  );
  return rows[0];
};

const cancelTransaction = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `UPDATE financial_transactions
       SET status = 'cancelado', canceled_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status <> 'cancelado' RETURNING *`,
    [id, tenant_id]
  );
  return rows[0];
};

module.exports = {
  listTransactions,
  getSummary,
  getTransactionById,
  getTransactionsByClient,
  getTransactionsByFine,
  createTransaction,
  updateTransaction,
  cancelTransaction,
};
