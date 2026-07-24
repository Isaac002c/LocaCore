const pool = require('../config/db');

// ============================================
// RENTAL FINES MODEL (§4) — multas da LOCADORA (contexto próprio; o módulo
// despachante `fines` permanece intacto). Tenant-scoped. Dinheiro em NUMERIC.
// ============================================

const STATUSES = ['identificada', 'aguardando_validacao', 'aguardando_condutor', 'comunicada',
  'aguardando_pagamento', 'cobrada', 'paga', 'recorrida', 'cancelada', 'encerrada'];

const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
const toDateOrNull = (v) => (v === '' || v === undefined || v === null ? null : String(v).substring(0, 10));
const toIntOrNull = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };
const cents = (v) => Math.round((Number(v) || 0) * 100);
const money2 = (v) => { const c = cents(v); return (c < 0 ? 0 : c / 100).toFixed(2); };
const total = (orig, fee) => ((cents(orig) + cents(fee)) / 100).toFixed(2);

const SELECT = `
  SELECT f.*, c.name AS client_name, v.plate AS vehicle_plate, v.brand AS vehicle_brand, v.model AS vehicle_model,
         r.rental_number
    FROM rental_fines f
    LEFT JOIN clients  c ON c.id = f.client_id  AND c.tenant_id = f.tenant_id
    LEFT JOIN vehicles v ON v.id = f.vehicle_id AND v.tenant_id = f.tenant_id
    LEFT JOIN rentals  r ON r.id = f.rental_id  AND r.tenant_id = f.tenant_id`;

const buildWhere = ({ status = '', rental_id = '', vehicle_id = '', client_id = '', q = '' }, tenant_id) => {
  const params = [tenant_id]; let where = 'WHERE f.tenant_id = $1';
  if (status)     { params.push(status);     where += ` AND f.status = $${params.length}`; }
  if (rental_id)  { params.push(rental_id);  where += ` AND f.rental_id = $${params.length}`; }
  if (vehicle_id) { params.push(vehicle_id); where += ` AND f.vehicle_id = $${params.length}`; }
  if (client_id)  { params.push(client_id);  where += ` AND f.client_id = $${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (f.fine_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR v.plate ILIKE $${params.length})`; }
  return { where, params };
};

const list = async (tenant_id, filters = {}, { limit, offset } = {}, db = pool) => {
  const { where, params } = buildWhere(filters, tenant_id);
  if (limit === undefined) {
    const r = await db.query(`${SELECT} ${where} ORDER BY f.created_at DESC LIMIT 500`, params);
    return r.rows;
  }
  const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM rental_fines f LEFT JOIN clients c ON c.id=f.client_id LEFT JOIN vehicles v ON v.id=f.vehicle_id ${where}`, params);
  const lim = Math.min(parseInt(limit, 10) || 20, 200), off = parseInt(offset, 10) || 0;
  const rows = await db.query(`${SELECT} ${where} ORDER BY f.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, lim, off]);
  return { rows: rows.rows, total: totalRes.rows[0].total, limit: lim, offset: off };
};

const getById = async (id, tenant_id, db = pool) => {
  const r = await db.query(`${SELECT} WHERE f.id = $1 AND f.tenant_id = $2`, [id, tenant_id]);
  return r.rows[0];
};

const create = async (data, db = pool) => {
  if (!data.tenant_id) throw new Error('tenant_id é obrigatório');
  const r = await db.query(
    `INSERT INTO rental_fines
       (tenant_id, rental_id, vehicle_id, client_id, driver_name, fine_number, organ, infraction_date,
        notification_date, due_date, original_amount, admin_fee, total_amount, points, description, notes,
        status, responsible_user_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [data.tenant_id, toStrOrNull(data.rental_id), toStrOrNull(data.vehicle_id), toStrOrNull(data.client_id),
     toStrOrNull(data.driver_name), toStrOrNull(data.fine_number), toStrOrNull(data.organ), toDateOrNull(data.infraction_date),
     toDateOrNull(data.notification_date), toDateOrNull(data.due_date), money2(data.original_amount), money2(data.admin_fee),
     total(data.original_amount, data.admin_fee), toIntOrNull(data.points) || 0, toStrOrNull(data.description), toStrOrNull(data.notes),
     STATUSES.includes(data.status) ? data.status : 'identificada', toStrOrNull(data.responsible_user_id), toStrOrNull(data.created_by)]
  );
  return r.rows[0];
};

const update = async (id, payload, tenant_id, db = pool) => {
  const cur = await getById(id, tenant_id, db);
  if (!cur) return undefined;
  const m = (k, fb) => (payload[k] === undefined ? fb : payload[k]);
  const orig = m('original_amount', cur.original_amount), fee = m('admin_fee', cur.admin_fee);
  const r = await db.query(
    `UPDATE rental_fines SET
        rental_id=$1, vehicle_id=$2, client_id=$3, driver_name=$4, fine_number=$5, organ=$6, infraction_date=$7,
        notification_date=$8, due_date=$9, original_amount=$10, admin_fee=$11, total_amount=$12, points=$13,
        description=$14, notes=$15, status=$16, responsible_user_id=$17, updated_at=NOW()
      WHERE id=$18 AND tenant_id=$19 RETURNING *`,
    [toStrOrNull(m('rental_id', cur.rental_id)), toStrOrNull(m('vehicle_id', cur.vehicle_id)), toStrOrNull(m('client_id', cur.client_id)),
     toStrOrNull(m('driver_name', cur.driver_name)), toStrOrNull(m('fine_number', cur.fine_number)), toStrOrNull(m('organ', cur.organ)),
     toDateOrNull(m('infraction_date', cur.infraction_date)), toDateOrNull(m('notification_date', cur.notification_date)), toDateOrNull(m('due_date', cur.due_date)),
     money2(orig), money2(fee), total(orig, fee), toIntOrNull(m('points', cur.points)) || 0,
     toStrOrNull(m('description', cur.description)), toStrOrNull(m('notes', cur.notes)),
     STATUSES.includes(payload.status) ? payload.status : cur.status, toStrOrNull(m('responsible_user_id', cur.responsible_user_id)), id, tenant_id]
  );
  return r.rows[0];
};

const setStatus = async (id, status, tenant_id, db = pool) => {
  if (!STATUSES.includes(status)) throw new Error('Status de multa inválido');
  const r = await db.query('UPDATE rental_fines SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *', [status, id, tenant_id]);
  return r.rows[0];
};

const setBilling = async (id, billing_id, tenant_id, db = pool) => {
  const r = await db.query(`UPDATE rental_fines SET billing_id=$1, status='cobrada', updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`, [billing_id, id, tenant_id]);
  return r.rows[0];
};
const setExtra = async (id, extra_id, tenant_id, db = pool) => {
  const r = await db.query('UPDATE rental_fines SET rental_extra_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *', [extra_id, id, tenant_id]);
  return r.rows[0];
};

const remove = async (id, tenant_id, db = pool) => {
  const r = await db.query('DELETE FROM rental_fines WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

const stats = async (tenant_id, db = pool) => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(CASE WHEN status NOT IN ('paga','cancelada','encerrada') THEN 1 END)::int AS abertas,
            COALESCE(SUM(CASE WHEN status NOT IN ('paga','cancelada','encerrada') THEN total_amount ELSE 0 END),0) AS valor_aberto
       FROM rental_fines WHERE tenant_id=$1`, [tenant_id]);
  return r.rows[0];
};

module.exports = { STATUSES, list, getById, create, update, setStatus, setBilling, setExtra, remove, stats };
