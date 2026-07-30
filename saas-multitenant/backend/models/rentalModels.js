const pool = require('../config/db');

// ============================================
// RENTALS MODEL — Locações (LocaCore)
// Entidade operacional central da locadora. Liga cliente (locatário) + veículo,
// com período, diárias, valores e caução. Tudo escopado por tenant_id (§5).
// Dinheiro em NUMERIC — cálculos em centavos inteiros para evitar ponto flutuante (§8.5).
//
// Todas as funções aceitam um executor opcional `db` (cliente de transação) e caem
// no pool quando ausente — permite orquestração atômica em services/rentalService.
// ============================================

const toStrOrNull = (v) => (v === '' || v === undefined || v === null ? null : v);
// DATE → 'YYYY-MM-DD'. O Postgres devolve DATE como objeto Date; String(date)
// .substring(0,10) daria "Mon Jul 27" e quebraria o UPDATE. Getters locais para
// não deslocar o dia por fuso horário.
const toDateOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).substring(0, 10);
};
const toIntOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const cents = (v) => Math.round((Number(v) || 0) * 100);
const money2 = (v) => {
  const c = cents(v);
  return (c < 0 ? 0 : c / 100).toFixed(2);
};
// Vistoria (§8): normaliza para JSON string (jsonb) ou null. Aceita objeto ou string.
const toJsonOrNull = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v)); } catch (_) { return null; } }
  try { return JSON.stringify(v); } catch (_) { return null; }
};

const STATUSES = ['reservado', 'em_andamento', 'atrasado', 'finalizado', 'cancelado'];
// Status que OCUPAM o veículo (bloqueiam disponibilidade e geram conflito).
const BLOCKING_STATUSES = ['reservado', 'em_andamento', 'atrasado'];
const ACTIVE_STATUSES = BLOCKING_STATUSES;

// Transições de status permitidas (§10). Fonte da verdade no backend.
const ALLOWED_TRANSITIONS = {
  reservado:    ['em_andamento', 'cancelado'],
  em_andamento: ['atrasado', 'finalizado', 'cancelado'],
  atrasado:     ['finalizado', 'cancelado', 'em_andamento'],
  finalizado:   [],            // terminal (reabertura exige ação administrativa explícita)
  cancelado:    [],            // terminal (reativar exige nova validação de disponibilidade)
};
const canTransition = (from, to) => from === to || (ALLOWED_TRANSITIONS[from] || []).includes(to);

// Nº de diárias timezone-safe (mínimo 1 quando há período).
const daysBetween = (start, end) => {
  if (!start || !end) return null;
  const [ys, ms, ds] = toDateOrNull(start).split('-').map(Number);
  const [ye, me, de] = toDateOrNull(end).split('-').map(Number);
  if (!ys || !ye) return null;
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 1;
};

// Total = diária × diárias + extras − desconto (nunca negativo), em centavos.
const computeTotal = ({ daily_rate, days, extras_amount, discount_amount }) => {
  const total = cents(daily_rate) * (toIntOrNull(days) || 0) + cents(extras_amount) - cents(discount_amount);
  return (total < 0 ? 0 : total / 100).toFixed(2);
};

const resolveDays = ({ days, start_date, end_date }) => {
  const explicit = toIntOrNull(days);
  if (explicit !== null && explicit >= 0) return explicit;
  return daysBetween(start_date, end_date) || 1;
};

// Numeração humana sequencial por tenant (LOC-000001).
const genRentalNumber = async (tenant_id, db = pool) => {
  const r = await db.query('SELECT COUNT(*)::int AS n FROM rentals WHERE tenant_id = $1', [tenant_id]);
  const next = (r.rows[0]?.n || 0) + 1;
  return 'LOC-' + String(next).padStart(6, '0');
};

// Projeção usada nas listagens/detalhe (com nomes de cliente e veículo).
const SELECT_WITH_JOINS = `
  SELECT r.*,
         c.name  AS client_name,
         c.cpf   AS client_cpf,
         c.phone AS client_phone,
         v.plate AS vehicle_plate,
         v.brand AS vehicle_brand,
         v.model AS vehicle_model
    FROM rentals r
    LEFT JOIN clients  c ON c.id = r.client_id  AND c.tenant_id = r.tenant_id
    LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.tenant_id = r.tenant_id`;

// ── Conflito/sobreposição (§3) ───────────────────────────────────────────────
// Retorna as locações que OCUPAM o mesmo veículo e cujo período se sobrepõe ao
// informado. Datas exatamente adjacentes NÃO conflitam (desigualdade estrita).
// Escopo obrigatório: tenant_id + vehicle_id + intervalo + exclusão do próprio id.
const findConflictingRentals = async (
  { tenant_id, vehicle_id, start_date, end_date, exclude_rental_id = null },
  db = pool,
) => {
  const s = toDateOrNull(start_date);
  const e = toDateOrNull(end_date);
  // Sem veículo ou sem período completo não há como aferir sobreposição.
  if (!tenant_id || !vehicle_id || !s || !e) return [];

  // Lista fixa de status que ocupam o veículo (constantes, sem entrada do usuário).
  const blockingIn = BLOCKING_STATUSES.map((st) => `'${st}'`).join(', ');
  const params = [tenant_id, vehicle_id, s, e];
  let sql = `
    SELECT id, rental_number, start_date, end_date, status
      FROM rentals
     WHERE tenant_id = $1
       AND vehicle_id = $2
       AND status IN (${blockingIn})
       AND start_date IS NOT NULL AND end_date IS NOT NULL
       AND start_date < $4::date
       AND end_date   > $3::date`;
  if (exclude_rental_id) {
    params.push(exclude_rental_id);
    sql += ` AND id <> $${params.length}`;
  }
  sql += ' ORDER BY start_date ASC LIMIT 5';
  const r = await db.query(sql, params);
  return r.rows;
};

// CREATE
const createRental = async (input, db = pool) => {
  const { tenant_id } = input;
  if (!tenant_id) throw new Error('tenant_id é obrigatório para criar uma locação');

  const number = toStrOrNull(input.rental_number) || await genRentalNumber(tenant_id, db);
  const days = resolveDays(input);
  const total = computeTotal({ ...input, days });
  const status = STATUSES.includes(input.status) ? input.status : 'reservado';

  const r = await db.query(
    `INSERT INTO rentals
       (tenant_id, rental_number, client_id, vehicle_id, status, start_date, end_date,
        daily_rate, days, extras_amount, discount_amount, total_amount, deposit_amount,
        pickup_odometer, pickup_location, notes, created_by, pickup_inspection)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      tenant_id, number, toStrOrNull(input.client_id), toStrOrNull(input.vehicle_id), status,
      toDateOrNull(input.start_date), toDateOrNull(input.end_date),
      money2(input.daily_rate), days, money2(input.extras_amount), money2(input.discount_amount),
      total, money2(input.deposit_amount),
      toIntOrNull(input.pickup_odometer), toStrOrNull(input.pickup_location),
      toStrOrNull(input.notes), toStrOrNull(input.created_by), toJsonOrNull(input.pickup_inspection),
    ]
  );
  return r.rows[0];
};

// Constrói WHERE + params compartilhados entre lista, contagem e paginação.
const buildRentalWhere = ({ status = '', client_id = '', vehicle_id = '', q = '', date_from = '', date_to = '' }, tenant_id) => {
  const params = [tenant_id];
  let where = 'WHERE r.tenant_id = $1';
  if (status)     { params.push(status);     where += ` AND r.status = $${params.length}`; }
  if (client_id)  { params.push(client_id);  where += ` AND r.client_id = $${params.length}`; }
  if (vehicle_id) { params.push(vehicle_id); where += ` AND r.vehicle_id = $${params.length}`; }
  if (date_from)  { params.push(String(date_from).substring(0, 10)); where += ` AND r.start_date >= $${params.length}`; }
  if (date_to)    { params.push(String(date_to).substring(0, 10));   where += ` AND r.start_date <= $${params.length}`; }
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (r.rental_number ILIKE $${params.length} OR c.name ILIKE $${params.length} OR v.plate ILIKE $${params.length})`;
  }
  return { where, params };
};

// READ — lista (legado): array direto, com teto de 500 (compatível com o front atual).
const getAllRentals = async (tenant_id, filters = {}, db = pool) => {
  const { where, params } = buildRentalWhere(filters, tenant_id);
  const r = await db.query(`${SELECT_WITH_JOINS} ${where} ORDER BY r.created_at DESC LIMIT 500`, params);
  return r.rows;
};

// READ — paginado: { rows, total }. Usado quando a rota recebe limit/offset.
const listRentalsPaged = async (tenant_id, filters = {}, { limit = 50, offset = 0 } = {}, db = pool) => {
  const { where, params } = buildRentalWhere(filters, tenant_id);
  const totalRes = await db.query(`SELECT COUNT(*)::int AS total FROM rentals r
     LEFT JOIN clients c ON c.id = r.client_id AND c.tenant_id = r.tenant_id
     LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.tenant_id = r.tenant_id ${where}`, params);
  const lim = Math.min(parseInt(limit, 10) || 50, 200);
  const off = parseInt(offset, 10) || 0;
  const rowsRes = await db.query(
    `${SELECT_WITH_JOINS} ${where} ORDER BY r.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, lim, off]
  );
  return { rows: rowsRes.rows, total: totalRes.rows[0].total, limit: lim, offset: off };
};

const getRentalById = async (id, tenant_id, db = pool) => {
  const r = await db.query(`${SELECT_WITH_JOINS} WHERE r.id = $1 AND r.tenant_id = $2`, [id, tenant_id]);
  return r.rows[0];
};

// Leitura com trava de linha (dentro de transação) para operações críticas.
const getRentalByIdForUpdate = async (id, tenant_id, db = pool) => {
  const r = await db.query('SELECT * FROM rentals WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenant_id]);
  return r.rows[0];
};

const getRentalsByClient = async (client_id, tenant_id, db = pool) => {
  const r = await db.query(
    `${SELECT_WITH_JOINS} WHERE r.client_id = $1 AND r.tenant_id = $2 ORDER BY r.created_at DESC`,
    [client_id, tenant_id]
  );
  return r.rows;
};

const getRentalsByVehicle = async (vehicle_id, tenant_id, db = pool) => {
  const r = await db.query(
    `${SELECT_WITH_JOINS} WHERE r.vehicle_id = $1 AND r.tenant_id = $2 ORDER BY r.created_at DESC`,
    [vehicle_id, tenant_id]
  );
  return r.rows;
};

// UPDATE — merge dos campos; recalcula days/total a partir do estado final.
const updateRental = async (id, payload, tenant_id, db = pool) => {
  const current = await getRentalById(id, tenant_id, db);
  if (!current) return undefined;
  const m = (k, fallback) => (payload[k] === undefined ? fallback : payload[k]);

  const merged = {
    daily_rate:      m('daily_rate', current.daily_rate),
    days:            payload.days,
    start_date:      m('start_date', current.start_date),
    end_date:        m('end_date', current.end_date),
    extras_amount:   m('extras_amount', current.extras_amount),
    discount_amount: m('discount_amount', current.discount_amount),
  };
  const days = payload.days !== undefined ? (toIntOrNull(payload.days) ?? current.days) : resolveDays(merged);
  const total = computeTotal({
    daily_rate: merged.daily_rate, days,
    extras_amount: merged.extras_amount, discount_amount: merged.discount_amount,
  });

  const r = await db.query(
    `UPDATE rentals SET
        rental_number=$1, client_id=$2, vehicle_id=$3, status=$4, start_date=$5, end_date=$6,
        daily_rate=$7, days=$8, extras_amount=$9, discount_amount=$10, total_amount=$11,
        deposit_amount=$12, pickup_odometer=$13, pickup_location=$14, notes=$15, updated_at=NOW()
      WHERE id=$16 AND tenant_id=$17 RETURNING *`,
    [
      toStrOrNull(m('rental_number', current.rental_number)),
      toStrOrNull(m('client_id', current.client_id)),
      toStrOrNull(m('vehicle_id', current.vehicle_id)),
      STATUSES.includes(payload.status) ? payload.status : current.status,
      toDateOrNull(merged.start_date), toDateOrNull(merged.end_date),
      money2(merged.daily_rate), days, money2(merged.extras_amount), money2(merged.discount_amount),
      total, money2(m('deposit_amount', current.deposit_amount)),
      toIntOrNull(m('pickup_odometer', current.pickup_odometer)),
      toStrOrNull(m('pickup_location', current.pickup_location)),
      toStrOrNull(m('notes', current.notes)),
      id, tenant_id,
    ]
  );
  return r.rows[0];
};

const setRentalStatus = async (id, status, tenant_id, db = pool) => {
  if (!STATUSES.includes(status)) throw new Error('Status de locação inválido');
  const r = await db.query(
    'UPDATE rentals SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *',
    [status, id, tenant_id]
  );
  return r.rows[0];
};

// Cancelamento com motivo (preserva histórico; não apaga vínculos financeiros).
const cancelRental = async (id, { reason } = {}, tenant_id, db = pool) => {
  const note = reason ? `Cancelada: ${reason}` : null;
  const r = await db.query(
    `UPDATE rentals SET status='cancelado',
        notes = CASE WHEN $1::text IS NULL THEN notes
                     WHEN notes IS NULL OR notes = '' THEN $1
                     ELSE notes || E'\\n' || $1 END,
        updated_at=NOW()
      WHERE id=$2 AND tenant_id=$3 RETURNING *`,
    [note, id, tenant_id]
  );
  return r.rows[0];
};

// Devolução (fecha a locação): registra data/hodômetro de devolução e finaliza.
const closeRental = async (id, { return_date, return_odometer, return_location, notes, return_inspection }, tenant_id, db = pool) => {
  const current = await getRentalById(id, tenant_id, db);
  if (!current) return undefined;
  const r = await db.query(
    `UPDATE rentals SET
        status='finalizado',
        return_date=$1, return_odometer=$2, return_location=$3,
        notes=COALESCE($4, notes),
        return_inspection=COALESCE($5, return_inspection), updated_at=NOW()
      WHERE id=$6 AND tenant_id=$7 RETURNING *`,
    [
      toDateOrNull(return_date) || new Date().toISOString().substring(0, 10),
      toIntOrNull(return_odometer),
      toStrOrNull(return_location),
      toStrOrNull(notes),
      toJsonOrNull(return_inspection),
      id, tenant_id,
    ]
  );
  return r.rows[0];
};

// Recalcula extras_amount (soma dos adicionais ATIVOS) e o total da locação.
// Cálculo em centavos no JS (sem ponto flutuante, sem aritmética SQL) — chamado
// após qualquer alteração em rental_extras. Tenant-scoped.
const recomputeTotals = async (id, tenant_id, db = pool) => {
  const sum = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total FROM rental_extras
      WHERE rental_id = $1 AND tenant_id = $2 AND status = 'ativo'`,
    [id, tenant_id]
  );
  const cur = await db.query(
    'SELECT daily_rate, days, discount_amount FROM rentals WHERE id = $1 AND tenant_id = $2',
    [id, tenant_id]
  );
  if (!cur.rows[0]) return undefined;
  const extrasCents = cents(sum.rows[0].total);
  const totalCents = cents(cur.rows[0].daily_rate) * (toIntOrNull(cur.rows[0].days) || 0)
    + extrasCents - cents(cur.rows[0].discount_amount);
  const extras = (extrasCents / 100).toFixed(2);
  const total = (totalCents < 0 ? 0 : totalCents / 100).toFixed(2);
  const r = await db.query(
    `UPDATE rentals SET extras_amount = $1, total_amount = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4 RETURNING *`,
    [extras, total, id, tenant_id]
  );
  return r.rows[0];
};

// Indicadores de locação (contrato) para dashboard.
const getRentalStats = async (tenant_id, db = pool) => {
  // CASE WHEN (e não FILTER) por portabilidade — mesmo padrão do código legado.
  const r = await db.query(
    `SELECT
        COUNT(*)::int                                                       AS total,
        COUNT(CASE WHEN status = 'reservado'    THEN 1 END)::int            AS reservado,
        COUNT(CASE WHEN status = 'em_andamento' THEN 1 END)::int            AS em_andamento,
        COUNT(CASE WHEN status = 'atrasado'     THEN 1 END)::int            AS atrasado,
        COUNT(CASE WHEN status = 'finalizado'   THEN 1 END)::int            AS finalizado,
        COUNT(CASE WHEN status = 'cancelado'    THEN 1 END)::int            AS cancelado,
        COALESCE(SUM(CASE WHEN status <> 'cancelado' THEN total_amount ELSE 0 END), 0)                               AS valor_total,
        COALESCE(SUM(CASE WHEN status IN ('reservado','em_andamento','atrasado') THEN total_amount ELSE 0 END), 0)   AS valor_em_aberto,
        COALESCE(SUM(CASE WHEN status IN ('em_andamento','atrasado') THEN deposit_amount ELSE 0 END), 0)             AS caucao_retida
       FROM rentals WHERE tenant_id = $1`,
    [tenant_id]
  );
  return r.rows[0];
};

// Marca como 'atrasado' as locações em andamento cujo end_date já passou.
const flagOverdue = async (tenant_id, db = pool) => {
  const r = await db.query(
    `UPDATE rentals SET status='atrasado', updated_at=NOW()
      WHERE tenant_id=$1 AND status='em_andamento'
        AND end_date IS NOT NULL AND end_date < CURRENT_DATE
      RETURNING id`,
    [tenant_id]
  );
  return r.rowCount;
};

const deleteRental = async (id, tenant_id, db = pool) => {
  const r = await db.query('DELETE FROM rentals WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, tenant_id]);
  return r.rows[0];
};

module.exports = {
  STATUSES,
  BLOCKING_STATUSES,
  ACTIVE_STATUSES,
  ALLOWED_TRANSITIONS,
  canTransition,
  daysBetween,
  computeTotal,
  findConflictingRentals,
  createRental,
  getAllRentals,
  listRentalsPaged,
  getRentalById,
  getRentalByIdForUpdate,
  getRentalsByClient,
  getRentalsByVehicle,
  updateRental,
  setRentalStatus,
  cancelRental,
  closeRental,
  recomputeTotals,
  getRentalStats,
  flagOverdue,
  deleteRental,
};
