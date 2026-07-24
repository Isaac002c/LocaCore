const pool = require('../config/db');

// ============================================
// TENANT CONFIG OPTIONS — listas parametrizáveis por tenant (§2.3/§6/§8).
// kind: 'vehicle_category' | 'rental_extra_category' | ...  Tudo tenant-scoped.
// Desativação lógica (active) — nunca exclui item já usado.
// ============================================

const listOptions = async (tenant_id, kind, { includeInactive = false } = {}) => {
  const filter = includeInactive ? '' : 'AND active = TRUE';
  const r = await pool.query(
    `SELECT * FROM tenant_config_options
      WHERE tenant_id = $1 AND kind = $2 ${filter}
      ORDER BY sort_order ASC, LOWER(value) ASC`,
    [tenant_id, kind]
  );
  return r.rows;
};

const getOptionById = async (id, tenant_id) => {
  const r = await pool.query('SELECT * FROM tenant_config_options WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return r.rows[0];
};

const createOption = async ({ tenant_id, kind, value, sort_order }) => {
  const r = await pool.query(
    `INSERT INTO tenant_config_options (tenant_id, kind, value, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [tenant_id, kind, String(value).trim(), Number.isFinite(+sort_order) ? +sort_order : 0]
  );
  return r.rows[0];
};

const updateOption = async (id, { value, sort_order, active }, tenant_id) => {
  const r = await pool.query(
    `UPDATE tenant_config_options SET
        value      = COALESCE($1, value),
        sort_order = COALESCE($2, sort_order),
        active     = COALESCE($3, active),
        updated_at = NOW()
      WHERE id = $4 AND tenant_id = $5 RETURNING *`,
    [
      value != null && value !== '' ? String(value).trim() : null,
      Number.isFinite(+sort_order) && sort_order !== '' && sort_order != null ? +sort_order : null,
      typeof active === 'boolean' ? active : null,
      id, tenant_id,
    ]
  );
  return r.rows[0];
};

// Seed idempotente dos valores padrão de um kind, apenas se o tenant ainda não
// tiver NENHUM item desse kind (não recria os que o usuário já ajustou).
const ensureDefaults = async (tenant_id, kind, values = []) => {
  const c = await pool.query(
    'SELECT COUNT(*)::int AS n FROM tenant_config_options WHERE tenant_id = $1 AND kind = $2',
    [tenant_id, kind]
  );
  if (c.rows[0].n > 0) return;
  for (let i = 0; i < values.length; i++) {
    try {
      await pool.query(
        `INSERT INTO tenant_config_options (tenant_id, kind, value, sort_order) VALUES ($1, $2, $3, $4)`,
        [tenant_id, kind, values[i], i]
      );
    } catch (_) { /* corrida/duplicado → ignora */ }
  }
};

const DEFAULTS = {
  vehicle_category: ['Hatch', 'Sedã', 'SUV', 'Utilitário', 'Van', 'Picape', 'Moto', 'Outro'],
  rental_extra_category: [
    'Combustível', 'Lavagem', 'Diária extra', 'Quilometragem excedente', 'Avaria',
    'Multa', 'Taxa administrativa', 'Proteção', 'Motorista adicional', 'Entrega/Retirada', 'Outro',
  ],
};

module.exports = { listOptions, getOptionById, createOption, updateOption, ensureDefaults, DEFAULTS };
