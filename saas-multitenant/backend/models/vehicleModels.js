const pool = require('../config/db');

// ============================================
// VEHICLES MODEL — Frota da locadora (LocaCore)
// Tudo escopado por tenant_id (isolamento multi-tenant §2.2/§5).
// Veículo = objeto locado. Distinto de company_vehicles (frota de EMPRESAS
// clientes no fluxo despachante), que permanece intacto.
// ============================================

const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
const toIntOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const toInt0 = (v) => toIntOrNull(v) ?? 0;
// Dinheiro: NUNCA ponto flutuante para armazenar. Normaliza para string com 2 casas.
const money2 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
};
const upperOrNull = (v) => {
  const s = toStrOrNull(v);
  return s ? String(s).toUpperCase().trim() : null;
};

const STATUSES = ['disponivel', 'alugado', 'manutencao', 'inativo'];

// CREATE
const createVehicle = async ({
  tenant_id, plate, brand, model, year, color, category, renavam, chassi,
  fuel, transmission, daily_rate, odometer, status, notes, created_by,
}) => {
  if (!tenant_id) throw new Error('tenant_id é obrigatório para criar um veículo');
  const r = await pool.query(
    `INSERT INTO vehicles
       (tenant_id, plate, brand, model, year, color, category, renavam, chassi,
        fuel, transmission, daily_rate, odometer, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      tenant_id,
      upperOrNull(plate), toStrOrNull(brand), toStrOrNull(model), toIntOrNull(year),
      toStrOrNull(color), toStrOrNull(category), toStrOrNull(renavam), toStrOrNull(chassi),
      toStrOrNull(fuel), toStrOrNull(transmission), money2(daily_rate), toInt0(odometer),
      STATUSES.includes(status) ? status : 'disponivel', toStrOrNull(notes), toStrOrNull(created_by),
    ]
  );
  return r.rows[0];
};

// READ — lista com filtro opcional por status e busca (placa/marca/modelo).
// LIMIT 500: proteção de performance; acima disso, paginar.
const getAllVehicles = async (tenant_id, { status = '', q = '' } = {}) => {
  const params = [tenant_id];
  let where = 'WHERE tenant_id = $1';
  if (status) { params.push(status); where += ` AND status = $${params.length}`; }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (plate ILIKE $${params.length} OR brand ILIKE $${params.length} OR model ILIKE $${params.length} OR category ILIKE $${params.length})`;
  }
  const r = await pool.query(
    `SELECT * FROM vehicles ${where} ORDER BY brand ASC, model ASC LIMIT 500`,
    params
  );
  return r.rows;
};

const getVehicleById = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return r.rows[0];
};

// Leitura com trava de linha (dentro de transação).
const getVehicleByIdForUpdate = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenant_id]);
  return r.rows[0];
};

const getVehicleByPlate = async (plate, tenant_id) => {
  const p = upperOrNull(plate);
  if (!p) return undefined;
  const r = await pool.query(
    'SELECT * FROM vehicles WHERE UPPER(plate) = $1 AND tenant_id = $2 LIMIT 1',
    [p, tenant_id]
  );
  return r.rows[0];
};

// Veículos disponíveis para nova locação (status disponível).
const getAvailableVehicles = async (tenant_id) => {
  const r = await pool.query(
    `SELECT * FROM vehicles WHERE tenant_id = $1 AND status = 'disponivel'
      ORDER BY brand ASC, model ASC LIMIT 500`,
    [tenant_id]
  );
  return r.rows;
};

// Estatísticas da frota por status (para dashboard/KPIs).
// CASE WHEN (e não FILTER) por portabilidade — mesmo padrão do código legado.
const getFleetStats = async (tenant_id) => {
  const r = await pool.query(
    `SELECT
        COUNT(*)::int                                              AS total,
        COUNT(CASE WHEN status = 'disponivel' THEN 1 END)::int     AS disponivel,
        COUNT(CASE WHEN status = 'alugado'    THEN 1 END)::int     AS alugado,
        COUNT(CASE WHEN status = 'manutencao' THEN 1 END)::int     AS manutencao,
        COUNT(CASE WHEN status = 'inativo'    THEN 1 END)::int     AS inativo
       FROM vehicles WHERE tenant_id = $1`,
    [tenant_id]
  );
  return r.rows[0] || { total: 0, disponivel: 0, alugado: 0, manutencao: 0, inativo: 0 };
};

// UPDATE — merge: só sobrescreve o que vier no payload (preserva o legado).
const updateVehicle = async (id, payload, tenant_id, db = pool) => {
  const current = await getVehicleById(id, tenant_id, db);
  if (!current) return undefined;
  const m = (k, fallback) => (payload[k] === undefined ? fallback : payload[k]);
  const r = await db.query(
    `UPDATE vehicles SET
        plate=$1, brand=$2, model=$3, year=$4, color=$5, category=$6, renavam=$7,
        chassi=$8, fuel=$9, transmission=$10, daily_rate=$11, odometer=$12,
        status=$13, notes=$14, updated_at=NOW()
      WHERE id=$15 AND tenant_id=$16 RETURNING *`,
    [
      upperOrNull(m('plate', current.plate)),
      toStrOrNull(m('brand', current.brand)),
      toStrOrNull(m('model', current.model)),
      toIntOrNull(m('year', current.year)),
      toStrOrNull(m('color', current.color)),
      toStrOrNull(m('category', current.category)),
      toStrOrNull(m('renavam', current.renavam)),
      toStrOrNull(m('chassi', current.chassi)),
      toStrOrNull(m('fuel', current.fuel)),
      toStrOrNull(m('transmission', current.transmission)),
      money2(m('daily_rate', current.daily_rate)),
      toInt0(m('odometer', current.odometer)),
      STATUSES.includes(payload.status) ? payload.status : current.status,
      toStrOrNull(m('notes', current.notes)),
      id, tenant_id,
    ]
  );
  return r.rows[0];
};

const setVehicleStatus = async (id, status, tenant_id, db = pool) => {
  if (!STATUSES.includes(status)) throw new Error('Status de veículo inválido');
  const r = await db.query(
    'UPDATE vehicles SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *',
    [status, id, tenant_id]
  );
  return r.rows[0];
};

// Locações ativas (reservado/em_andamento/atrasado) de um veículo — guarda de exclusão
// e de disponibilidade. Retorna a contagem.
const countActiveRentals = async (vehicle_id, tenant_id, db = pool) => {
  const r = await db.query(
    `SELECT COUNT(*)::int AS total FROM rentals
      WHERE vehicle_id = $1 AND tenant_id = $2
        AND status IN ('reservado','em_andamento','atrasado')`,
    [vehicle_id, tenant_id]
  );
  return r.rows[0].total;
};

// Deriva o status do veículo a partir das locações reais: 'alugado' se houver
// locação EM CURSO (em_andamento/atrasado); senão 'disponivel'. Estados manuais
// ('manutencao'/'inativo') não são sobrescritos. Reserva futura NÃO ocupa o veículo
// (a disponibilidade por período é garantida pela validação de conflito).
const refreshVehicleStatus = async (vehicle_id, tenant_id, db = pool) => {
  if (!vehicle_id) return undefined;
  const veh = await getVehicleById(vehicle_id, tenant_id, db);
  if (!veh || veh.status === 'manutencao' || veh.status === 'inativo') return veh;
  const r = await db.query(
    `SELECT 1 FROM rentals
      WHERE vehicle_id = $1 AND tenant_id = $2 AND status IN ('em_andamento','atrasado') LIMIT 1`,
    [vehicle_id, tenant_id]
  );
  const target = r.rows.length ? 'alugado' : 'disponivel';
  if (veh.status !== target) return setVehicleStatus(vehicle_id, target, tenant_id, db);
  return veh;
};

// DELETE — a rota impede exclusão com locação ativa; aqui apenas executa escopado.
const deleteVehicle = async (id, tenant_id) => {
  const r = await pool.query('DELETE FROM vehicles WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

module.exports = {
  STATUSES,
  createVehicle,
  getAllVehicles,
  getVehicleById,
  getVehicleByIdForUpdate,
  getVehicleByPlate,
  getAvailableVehicles,
  getFleetStats,
  updateVehicle,
  setVehicleStatus,
  countActiveRentals,
  refreshVehicleStatus,
  deleteVehicle,
};
