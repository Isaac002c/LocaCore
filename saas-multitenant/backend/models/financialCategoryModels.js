const pool = require('../config/db');
const { DEFAULT_CATEGORIES } = require('../services/finance/constants');

// ============================================
// FINANCIAL CATEGORIES MODEL
// Todas as queries são tenant-scoped.
// ============================================

// Cria (idempotentemente) as categorias iniciais do tenant.
// Usa ON CONFLICT DO NOTHING sobre uq_financial_categories (tenant_id,type,name).
const ensureDefaultCategories = async (tenant_id) => {
  if (!tenant_id) throw new Error('tenant_id é obrigatório');
  const values = [];
  const params = [tenant_id];
  DEFAULT_CATEGORIES.forEach((c, i) => {
    values.push(`($1, $${i * 2 + 2}, $${i * 2 + 3})`);
    params.push(c.name, c.type);
  });
  await pool.query(
    `INSERT INTO financial_categories (tenant_id, name, type)
     VALUES ${values.join(', ')}
     ON CONFLICT (tenant_id, type, name) DO NOTHING`,
    params
  );
};

const listCategories = async (tenant_id, { type, active } = {}) => {
  let q = `SELECT * FROM financial_categories WHERE tenant_id = $1`;
  const params = [tenant_id];
  let i = 2;
  if (type)   { q += ` AND type = $${i++}`; params.push(type); }
  if (active !== undefined && active !== null && active !== '') {
    q += ` AND active = $${i++}`; params.push(active === true || active === 'true');
  }
  q += ` ORDER BY type ASC, name ASC`;
  const { rows } = await pool.query(q, params);
  return rows;
};

const getCategoryById = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `SELECT * FROM financial_categories WHERE id = $1 AND tenant_id = $2`,
    [id, tenant_id]
  );
  return rows[0];
};

const createCategory = async ({ tenant_id, name, type, description }) => {
  const { rows } = await pool.query(
    `INSERT INTO financial_categories (tenant_id, name, type, description)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenant_id, name, type, description || null]
  );
  return rows[0];
};

const updateCategory = async (id, { name, type, description, active }, tenant_id) => {
  const { rows } = await pool.query(
    `UPDATE financial_categories
       SET name = COALESCE($1, name),
           type = COALESCE($2, type),
           description = $3,
           active = COALESCE($4, active),
           updated_at = NOW()
     WHERE id = $5 AND tenant_id = $6 RETURNING *`,
    [name || null, type || null, description ?? null, active, id, tenant_id]
  );
  return rows[0];
};

const setActive = async (id, active, tenant_id) => {
  const { rows } = await pool.query(
    `UPDATE financial_categories SET active = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 RETURNING *`,
    [active, id, tenant_id]
  );
  return rows[0];
};

// Categoria possui lançamentos vinculados? (bloqueia exclusão física)
const countTransactions = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM financial_transactions
     WHERE category_id = $1 AND tenant_id = $2`,
    [id, tenant_id]
  );
  return rows[0].total;
};

const deleteCategory = async (id, tenant_id) => {
  const { rows } = await pool.query(
    `DELETE FROM financial_categories WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenant_id]
  );
  return rows[0];
};

// Busca uma categoria por nome+tipo (para vincular lançamentos automáticos).
const findByName = async (tenant_id, name, type) => {
  const { rows } = await pool.query(
    `SELECT * FROM financial_categories
     WHERE tenant_id = $1 AND type = $2 AND LOWER(name) = LOWER($3) LIMIT 1`,
    [tenant_id, type, name]
  );
  return rows[0];
};

module.exports = {
  ensureDefaultCategories,
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  setActive,
  countTransactions,
  deleteCategory,
  findByName,
};
