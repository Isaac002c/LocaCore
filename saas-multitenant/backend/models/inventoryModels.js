const pool = require('../config/db');
const { withTransaction } = require('../services/tx');

// ============================================
// INVENTORY MODEL (§5) — Estoque. Itens + movimentações transacionais.
// Saldo calculado no backend (milésimos inteiros, sem float). Sem estoque
// negativo salvo allow_negative. Tenant-scoped.
// ============================================

const POS = ['entrada', 'ajuste_pos', 'devolucao'];
const NEG = ['saida', 'ajuste_neg', 'consumo', 'perda'];
const TYPES = [...POS, ...NEG];

const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
const q3 = (v) => Math.round((Number(v) || 0) * 1000);          // milésimos
const q3str = (thousandths) => (thousandths / 1000).toFixed(3);
const money2 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? (Math.round(n * 100) / 100).toFixed(2) : '0.00'; };

// ── Itens ─────────────────────────────────────────────────────────────────────
const listItems = async (tenant_id, { q = '', category = '', active = '', limit, offset } = {}) => {
  const params = [tenant_id]; let where = 'WHERE tenant_id = $1';
  if (q) { params.push(`%${q}%`); where += ` AND (name ILIKE $${params.length} OR code ILIKE $${params.length})`; }
  if (category) { params.push(category); where += ` AND category = $${params.length}`; }
  if (active !== '') { params.push(active === 'true' || active === true); where += ` AND active = $${params.length}`; }
  if (limit === undefined) {
    const r = await pool.query(`SELECT * FROM inventory_items ${where} ORDER BY name ASC LIMIT 500`, params);
    return r.rows;
  }
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM inventory_items ${where}`, params);
  const lim = Math.min(parseInt(limit, 10) || 20, 200), off = parseInt(offset, 10) || 0;
  const rows = await pool.query(`SELECT * FROM inventory_items ${where} ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, lim, off]);
  return { rows: rows.rows, total: totalRes.rows[0].total, limit: lim, offset: off };
};

const getItem = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM inventory_items WHERE id=$1 AND tenant_id=$2', [id, tenant_id]);
  return r.rows[0];
};

const createItem = async (d) => {
  const r = await pool.query(
    `INSERT INTO inventory_items (tenant_id, name, code, category, unit, description, quantity, min_quantity, unit_cost, location, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,TRUE),$12) RETURNING *`,
    [d.tenant_id, d.name, toStrOrNull(d.code), toStrOrNull(d.category), d.unit || 'un', toStrOrNull(d.description),
     q3str(q3(d.quantity)), q3str(q3(d.min_quantity)), money2(d.unit_cost), toStrOrNull(d.location),
     typeof d.active === 'boolean' ? d.active : true, toStrOrNull(d.created_by)]
  );
  return r.rows[0];
};

const updateItem = async (id, p, tenant_id) => {
  const cur = await getItem(id, tenant_id);
  if (!cur) return undefined;
  const m = (k, fb) => (p[k] === undefined ? fb : p[k]);
  const r = await pool.query(
    `UPDATE inventory_items SET name=$1, code=$2, category=$3, unit=$4, description=$5, min_quantity=$6, unit_cost=$7, location=$8, active=$9, updated_at=NOW()
      WHERE id=$10 AND tenant_id=$11 RETURNING *`,
    [m('name', cur.name), toStrOrNull(m('code', cur.code)), toStrOrNull(m('category', cur.category)), m('unit', cur.unit) || 'un',
     toStrOrNull(m('description', cur.description)), q3str(q3(m('min_quantity', cur.min_quantity))), money2(m('unit_cost', cur.unit_cost)),
     toStrOrNull(m('location', cur.location)), typeof p.active === 'boolean' ? p.active : cur.active, id, tenant_id]
  );
  return r.rows[0];   // não altera quantity aqui — só por movimentação
};

const deleteItem = async (id, tenant_id) => {
  const r = await pool.query('DELETE FROM inventory_items WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

// ── Movimentações (transacional) ──────────────────────────────────────────────
const createMovement = async (d) => {
  if (!TYPES.includes(d.type)) throw new Error('Tipo de movimentação inválido');
  if (q3(d.quantity) <= 0) throw new Error('Quantidade deve ser maior que zero');
  return withTransaction(async (db) => {
    const lock = await db.query('SELECT * FROM inventory_items WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [d.item_id, d.tenant_id]);
    const item = lock.rows[0];
    if (!item) { const e = new Error('Item não encontrado'); e.statusCode = 404; throw e; }
    const delta = (POS.includes(d.type) ? 1 : -1) * q3(d.quantity);
    const newBal = q3(item.quantity) + delta;
    if (newBal < 0 && !d.allow_negative) { const e = new Error('Estoque insuficiente para esta saída.'); e.statusCode = 409; throw e; }
    await db.query('UPDATE inventory_items SET quantity=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [q3str(newBal), d.item_id, d.tenant_id]);
    const r = await db.query(
      `INSERT INTO inventory_movements (tenant_id, item_id, type, quantity, unit_cost, balance_after, reason, movement_date,
         vehicle_id, rental_id, maintenance_id, supplier, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,CURRENT_DATE),$9,$10,$11,$12,$13,$14) RETURNING *`,
      [d.tenant_id, d.item_id, d.type, q3str(q3(d.quantity)), money2(d.unit_cost != null ? d.unit_cost : item.unit_cost), q3str(newBal),
       toStrOrNull(d.reason), d.movement_date || null, toStrOrNull(d.vehicle_id), toStrOrNull(d.rental_id), toStrOrNull(d.maintenance_id),
       toStrOrNull(d.supplier), toStrOrNull(d.notes), toStrOrNull(d.created_by)]
    );
    return { movement: r.rows[0], item: { ...item, quantity: q3str(newBal) } };
  });
};

const listMovements = async (tenant_id, { item_id = '', limit = 50, offset = 0 } = {}) => {
  const params = [tenant_id]; let where = 'WHERE m.tenant_id = $1';
  if (item_id) { params.push(item_id); where += ` AND m.item_id = $${params.length}`; }
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM inventory_movements m ${where}`, params);
  const lim = Math.min(parseInt(limit, 10) || 50, 200), off = parseInt(offset, 10) || 0;
  const rows = await pool.query(
    `SELECT m.*, i.name AS item_name, i.unit AS item_unit FROM inventory_movements m
       LEFT JOIN inventory_items i ON i.id = m.item_id
       ${where} ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, lim, off]
  );
  return { rows: rows.rows, total: totalRes.rows[0].total, limit: lim, offset: off };
};

const dashboard = async (tenant_id) => {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total_itens,
            COUNT(CASE WHEN quantity <= min_quantity AND active THEN 1 END)::int AS abaixo_minimo,
            COALESCE(SUM(quantity * unit_cost), 0) AS valor_estimado
       FROM inventory_items WHERE tenant_id=$1`, [tenant_id]);
  const below = await pool.query(`SELECT id, name, quantity, min_quantity, unit FROM inventory_items WHERE tenant_id=$1 AND active AND quantity <= min_quantity ORDER BY name LIMIT 50`, [tenant_id]);
  return { ...r.rows[0], itens_abaixo_minimo: below.rows };
};

module.exports = { TYPES, listItems, getItem, createItem, updateItem, deleteItem, createMovement, listMovements, dashboard };
