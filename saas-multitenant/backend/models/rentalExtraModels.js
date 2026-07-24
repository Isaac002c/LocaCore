const pool = require('../config/db');

// ============================================
// RENTAL EXTRAS — adicionais/cobranças extras itemizados da locação (§9).
// total_amount = quantity × unit_amount, em centavos (sem ponto flutuante).
// Baixa é LÓGICA (status 'cancelado'); a soma dos ATIVOS alimenta o total da
// locação via rentalModels.recomputeTotals.
// ============================================

const cents = (v) => Math.round((Number(v) || 0) * 100);
const money2 = (v) => { const c = cents(v); return (c < 0 ? 0 : c / 100).toFixed(2); };
const toDateOrNull = (v) => (v === '' || v === undefined || v === null ? null : String(v).substring(0, 10));
const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);

const listByRental = async (rental_id, tenant_id, { includeCanceled = false } = {}, db = pool) => {
  const filter = includeCanceled ? '' : "AND status = 'ativo'";
  const r = await db.query(
    `SELECT * FROM rental_extras WHERE rental_id = $1 AND tenant_id = $2 ${filter} ORDER BY created_at ASC`,
    [rental_id, tenant_id]
  );
  return r.rows;
};

const getById = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM rental_extras WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return r.rows[0];
};

const create = async ({ tenant_id, rental_id, category, description, quantity, unit_amount, extra_date, created_by }, db = pool) => {
  if (!tenant_id || !rental_id) throw new Error('tenant_id e rental_id são obrigatórios');
  const qtyNum = Number(quantity);
  const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1;
  const total = (Math.round(qty * cents(unit_amount)) / 100).toFixed(2);
  const r = await db.query(
    `INSERT INTO rental_extras
       (tenant_id, rental_id, category, description, quantity, unit_amount, total_amount, extra_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ativo',$9) RETURNING *`,
    [
      tenant_id, rental_id, toStrOrNull(category), toStrOrNull(description),
      qty.toFixed(2), money2(unit_amount), total, toDateOrNull(extra_date), toStrOrNull(created_by),
    ]
  );
  return r.rows[0];
};

// Baixa lógica (preserva histórico).
const cancel = async (id, tenant_id, db = pool) => {
  const r = await db.query(
    `UPDATE rental_extras SET status = 'cancelado', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND status = 'ativo' RETURNING *`,
    [id, tenant_id]
  );
  return r.rows[0];
};

module.exports = { listByRental, getById, create, cancel };
