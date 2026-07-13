const pool = require('../config/db');

// ============================================
// PAYMENTS MODEL (leituras; escrita transacional em services/finance/paymentService)
// ============================================

// receipt_id via LEFT JOIN (há no máximo 1 recibo 'emitido' por pagamento —
// garantido pelo receiptService). Evita subquery correlacionada e é portável.
const SELECT_BASE = `
  SELECT p.*,
         c.name AS client_name,
         c.cpf  AS client_cpf,
         f.fine_number AS fine_number,
         u.name AS created_by_name,
         r.id   AS receipt_id
    FROM payments p
    LEFT JOIN clients c   ON p.client_id = c.id
    LEFT JOIN fines f     ON p.fine_id = f.id
    LEFT JOIN users u     ON p.created_by = u.id
    LEFT JOIN receipts r  ON r.payment_id = p.id AND r.status = 'emitido'
`;

const listPayments = async (tenant_id, filters = {}) => {
  const {
    billing_id, client_id, fine_id, status, payment_method,
    date_from, date_to, limit = 20, offset = 0,
  } = filters;

  const where = ['p.tenant_id = $1'];
  const params = [tenant_id];
  let i = 2;
  if (billing_id)     { where.push(`p.billing_id = $${i++}`); params.push(billing_id); }
  if (client_id)      { where.push(`p.client_id = $${i++}`); params.push(client_id); }
  if (fine_id)        { where.push(`p.fine_id = $${i++}`); params.push(fine_id); }
  if (status)         { where.push(`p.status = $${i++}`); params.push(status); }
  if (payment_method) { where.push(`p.payment_method = $${i++}`); params.push(payment_method); }
  if (date_from)      { where.push(`p.payment_date >= $${i++}`); params.push(date_from); }
  if (date_to)        { where.push(`p.payment_date <= $${i++}`); params.push(date_to); }

  const whereSql = where.join(' AND ');
  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM payments p WHERE ${whereSql}`, params
  );
  const dataRes = await pool.query(
    `${SELECT_BASE} WHERE ${whereSql} ORDER BY p.payment_date DESC, p.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, Math.min(parseInt(limit, 10) || 20, 100), parseInt(offset, 10) || 0]
  );
  return { rows: dataRes.rows, total: totalRes.rows[0].total };
};

const getPaymentById = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE p.id = $1 AND p.tenant_id = $2`,
    [id, tenant_id]
  );
  return rows[0];
};

const getPaymentsByBilling = async (billing_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE p.billing_id = $1 AND p.tenant_id = $2
     ORDER BY p.installment_number ASC, p.payment_date ASC`,
    [billing_id, tenant_id]
  );
  return rows;
};

const getPaymentsByClient = async (client_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE p.client_id = $1 AND p.tenant_id = $2 ORDER BY p.payment_date DESC`,
    [client_id, tenant_id]
  );
  return rows;
};

const getPaymentsByFine = async (fine_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE p.fine_id = $1 AND p.tenant_id = $2 ORDER BY p.payment_date DESC`,
    [fine_id, tenant_id]
  );
  return rows;
};

module.exports = {
  listPayments,
  getPaymentById,
  getPaymentsByBilling,
  getPaymentsByClient,
  getPaymentsByFine,
};
