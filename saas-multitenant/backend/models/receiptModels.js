const pool = require('../config/db');

// ============================================
// RECEIPTS MODEL (leituras; emissão/cancelamento transacional em receiptService)
// ============================================

const SELECT_BASE = `
  SELECT r.*,
         c.name AS current_client_name,
         f.fine_number AS fine_number,
         u.name AS issued_by_name
    FROM receipts r
    LEFT JOIN clients c ON r.client_id = c.id
    LEFT JOIN fines f   ON r.fine_id = f.id
    LEFT JOIN users u   ON r.created_by = u.id
`;

const listReceipts = async (tenant_id, filters = {}) => {
  const {
    client_id, fine_id, payment_id, payment_method, status, date_from, date_to, search,
    limit = 20, offset = 0,
  } = filters;

  const where = ['r.tenant_id = $1'];
  const params = [tenant_id];
  let i = 2;
  if (client_id)      { where.push(`r.client_id = $${i++}`); params.push(client_id); }
  if (fine_id)        { where.push(`r.fine_id = $${i++}`); params.push(fine_id); }
  if (payment_id)     { where.push(`r.payment_id = $${i++}`); params.push(payment_id); }
  if (payment_method) { where.push(`r.payment_method = $${i++}`); params.push(payment_method); }
  if (status)         { where.push(`r.status = $${i++}`); params.push(status); }
  if (date_from)      { where.push(`r.issue_date >= $${i++}`); params.push(date_from); }
  if (date_to)        { where.push(`r.issue_date <= $${i++}`); params.push(date_to); }
  if (search)         { where.push(`(r.full_number ILIKE $${i} OR r.client_name ILIKE $${i})`); params.push(`%${search}%`); i++; }

  const whereSql = where.join(' AND ');
  const totalRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM receipts r WHERE ${whereSql}`, params
  );
  const dataRes = await pool.query(
    `${SELECT_BASE} WHERE ${whereSql} ORDER BY r.number DESC
     LIMIT $${i++} OFFSET $${i++}`,
    [...params, Math.min(parseInt(limit, 10) || 20, 100), parseInt(offset, 10) || 0]
  );
  return { rows: dataRes.rows, total: totalRes.rows[0].total };
};

const getReceiptById = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE r.id = $1 AND r.tenant_id = $2`, [id, tenant_id]
  );
  return rows[0];
};

const getReceiptsByClient = async (client_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE r.client_id = $1 AND r.tenant_id = $2 ORDER BY r.number DESC`,
    [client_id, tenant_id]
  );
  return rows;
};

const getReceiptsByFine = async (fine_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE r.fine_id = $1 AND r.tenant_id = $2 ORDER BY r.number DESC`,
    [fine_id, tenant_id]
  );
  return rows;
};

const getReceiptsByBilling = async (billing_id, tenant_id) => {
  const { rows } = await pool.query(
    `${SELECT_BASE} WHERE r.billing_id = $1 AND r.tenant_id = $2 ORDER BY r.number DESC`,
    [billing_id, tenant_id]
  );
  return rows;
};

const getActiveReceiptByPayment = async (payment_id, tenant_id) => {
  const { rows } = await pool.query(
    `SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2 AND status = 'emitido' LIMIT 1`,
    [payment_id, tenant_id]
  );
  return rows[0];
};

module.exports = {
  listReceipts,
  getReceiptById,
  getReceiptsByClient,
  getReceiptsByFine,
  getReceiptsByBilling,
  getActiveReceiptByPayment,
};
