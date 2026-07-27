const pool = require('../config/db');

// ============================================
// VEHICLE MAINTENANCES MODEL (§27) — manutenções da frota. Tenant-scoped.
// Veículo em manutenção não é elegível para locação (regra aplicada no
// rentalService.create via status do veículo = 'manutencao').
// ============================================

const STATUSES = ['agendada', 'em_andamento', 'concluida', 'cancelada'];
const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
// DATE → 'YYYY-MM-DD'. O driver do Postgres devolve DATE como objeto Date; usar
// String(date).substring(0,10) produziria "Mon Jul 27" e quebraria o UPDATE.
// Getters locais (não toISOString) para não deslocar o dia por fuso horário.
const toDateOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).substring(0, 10);
};
const toIntOrNull = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };
const money2 = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? (Math.round(n * 100) / 100).toFixed(2) : '0.00'; };

const SELECT = `
  SELECT m.*, v.plate AS vehicle_plate, v.brand AS vehicle_brand, v.model AS vehicle_model
    FROM vehicle_maintenances m
    LEFT JOIN vehicles v ON v.id = m.vehicle_id AND v.tenant_id = m.tenant_id`;

const list = async (tenant_id, { status = '', vehicle_id = '' } = {}) => {
  const params = [tenant_id]; let where = 'WHERE m.tenant_id = $1';
  if (status) { params.push(status); where += ` AND m.status = $${params.length}`; }
  if (vehicle_id) { params.push(vehicle_id); where += ` AND m.vehicle_id = $${params.length}`; }
  const r = await pool.query(`${SELECT} ${where} ORDER BY COALESCE(m.scheduled_date, m.created_at::date) DESC LIMIT 500`, params);
  return r.rows;
};

const getById = async (id, tenant_id) => {
  const r = await pool.query(`${SELECT} WHERE m.id = $1 AND m.tenant_id = $2`, [id, tenant_id]);
  return r.rows[0];
};

const create = async ({ tenant_id, vehicle_id, type, status, scheduled_date, done_date, odometer_scheduled, odometer_done, cost, supplier, notes, created_by }) => {
  if (!tenant_id || !vehicle_id) throw new Error('tenant_id e vehicle_id são obrigatórios');
  const r = await pool.query(
    `INSERT INTO vehicle_maintenances
       (tenant_id, vehicle_id, type, status, scheduled_date, done_date, odometer_scheduled, odometer_done, cost, supplier, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [tenant_id, vehicle_id, toStrOrNull(type), STATUSES.includes(status) ? status : 'agendada',
     toDateOrNull(scheduled_date), toDateOrNull(done_date), toIntOrNull(odometer_scheduled), toIntOrNull(odometer_done),
     money2(cost), toStrOrNull(supplier), toStrOrNull(notes), toStrOrNull(created_by)]
  );
  return r.rows[0];
};

const update = async (id, payload, tenant_id) => {
  const cur = await getById(id, tenant_id);
  if (!cur) return undefined;
  const m = (k, fb) => (payload[k] === undefined ? fb : payload[k]);
  const r = await pool.query(
    `UPDATE vehicle_maintenances SET
        type=$1, status=$2, scheduled_date=$3, done_date=$4, odometer_scheduled=$5, odometer_done=$6,
        cost=$7, supplier=$8, notes=$9, updated_at=NOW()
      WHERE id=$10 AND tenant_id=$11 RETURNING *`,
    [toStrOrNull(m('type', cur.type)), STATUSES.includes(payload.status) ? payload.status : cur.status,
     toDateOrNull(m('scheduled_date', cur.scheduled_date)), toDateOrNull(m('done_date', cur.done_date)),
     toIntOrNull(m('odometer_scheduled', cur.odometer_scheduled)), toIntOrNull(m('odometer_done', cur.odometer_done)),
     money2(m('cost', cur.cost)), toStrOrNull(m('supplier', cur.supplier)), toStrOrNull(m('notes', cur.notes)), id, tenant_id]
  );
  return r.rows[0];
};

const setStatus = async (id, status, tenant_id) => {
  if (!STATUSES.includes(status)) throw new Error('Status de manutenção inválido');
  const done = status === 'concluida' ? ', done_date = COALESCE(done_date, CURRENT_DATE)' : '';
  const r = await pool.query(`UPDATE vehicle_maintenances SET status=$1${done}, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`, [status, id, tenant_id]);
  return r.rows[0];
};

const remove = async (id, tenant_id) => {
  const r = await pool.query('DELETE FROM vehicle_maintenances WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

// Manutenções próximas/vencidas (para alertas e dashboard). Limite calculado em JS.
const upcomingOrOverdue = async (tenant_id, days = 7) => {
  const bound = new Date(Date.now() + (parseInt(days, 10) || 7) * 86400000).toISOString().substring(0, 10);
  const r = await pool.query(
    `${SELECT} WHERE m.tenant_id = $1 AND m.status IN ('agendada','em_andamento')
        AND m.scheduled_date IS NOT NULL AND m.scheduled_date <= $2
      ORDER BY m.scheduled_date ASC`,
    [tenant_id, bound]
  );
  return r.rows;
};

module.exports = { STATUSES, list, getById, create, update, setStatus, remove, upcomingOrOverdue };
