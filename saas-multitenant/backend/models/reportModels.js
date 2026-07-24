const pool = require('../config/db');

// ============================================
// REPORTS MODEL (§ Dashboard/Relatórios) — agregações operacionais e financeiras
// da locadora. Tudo tenant-scoped. Cada consulta é tolerante (CASE WHEN, sem
// FILTER) e cai em default se uma tabela não existir no ambiente.
// ============================================

const q = async (sql, params, dflt) => {
  try { return (await pool.query(sql, params)).rows; }
  catch (_) { return dflt; }
};
const num = (v) => Number(v) || 0;
const today = () => new Date().toISOString().substring(0, 10);

// Snapshot consolidado para o Painel (uma chamada).
const overview = async (tenant_id) => {
  const t = today();

  const fleetRows = await q('SELECT status, COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1 GROUP BY status', [tenant_id], []);
  const fleet = { total: 0, disponivel: 0, alugado: 0, manutencao: 0, inativo: 0 };
  for (const r of fleetRows) { fleet.total += num(r.n); if (fleet[r.status] !== undefined) fleet[r.status] = num(r.n); }

  const rentalRows = await q('SELECT status, COUNT(*)::int AS n FROM rentals WHERE tenant_id = $1 GROUP BY status', [tenant_id], []);
  const rentals = { reservado: 0, em_andamento: 0, atrasado: 0, finalizado: 0, cancelado: 0 };
  for (const r of rentalRows) if (rentals[r.status] !== undefined) rentals[r.status] = num(r.n);
  rentals.ativas = rentals.em_andamento + rentals.atrasado;

  const pickups = await q(
    `SELECT COUNT(*)::int AS n FROM rentals WHERE tenant_id = $1 AND start_date = $2 AND status IN ('reservado','em_andamento')`,
    [tenant_id, t], [{ n: 0 }]);
  const returns = await q(
    `SELECT COUNT(*)::int AS n FROM rentals WHERE tenant_id = $1 AND end_date = $2 AND status IN ('em_andamento','atrasado')`,
    [tenant_id, t], [{ n: 0 }]);

  const finesRow = await q(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0) AS total FROM rental_fines
      WHERE tenant_id = $1 AND status NOT IN ('paga','cancelada','encerrada')`,
    [tenant_id], [{ n: 0, total: 0 }]);

  const lowStock = await q(
    `SELECT COUNT(*)::int AS n FROM inventory_items WHERE tenant_id = $1 AND active = true AND quantity <= min_quantity`,
    [tenant_id], [{ n: 0 }]);

  // Financeiro do mês corrente (service_billings vinculados a locações).
  const monthStart = t.substring(0, 8) + '01';
  const fin = await q(
    `SELECT COALESCE(SUM(final_amount),0) AS faturado, COALESCE(SUM(paid_amount),0) AS recebido
       FROM service_billings WHERE tenant_id = $1 AND rental_id IS NOT NULL AND created_at >= $2`,
    [tenant_id, monthStart], [{ faturado: 0, recebido: 0 }]);

  const openValue = await q(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COALESCE(SUM(deposit_amount),0) AS caucao
       FROM rentals WHERE tenant_id = $1 AND status IN ('reservado','em_andamento','atrasado')`,
    [tenant_id], [{ total: 0, caucao: 0 }]);

  return {
    fleet,
    rentals,
    hoje: { retiradas: num(pickups[0].n), devolucoes: num(returns[0].n) },
    multas: { abertas: num(finesRow[0].n), valor: num(finesRow[0].total) },
    estoque: { abaixo_minimo: num(lowStock[0].n) },
    financeiro: {
      faturado_mes: num(fin[0].faturado), recebido_mes: num(fin[0].recebido),
      valor_em_aberto: num(openValue[0].total), caucao_retida: num(openValue[0].caucao),
    },
  };
};

// Relatório de faturamento por período (linhas por locação faturada).
const revenue = async (tenant_id, { from, to } = {}) => {
  const f = (from && String(from).substring(0, 10)) || (today().substring(0, 8) + '01');
  const t = (to && String(to).substring(0, 10)) || today();
  const rows = await q(
    `SELECT b.id, b.created_at::date AS data, b.description, b.final_amount, b.paid_amount, b.financial_status,
            r.rental_number, c.name AS client_name, v.plate AS vehicle_plate
       FROM service_billings b
       LEFT JOIN rentals  r ON r.id = b.rental_id AND r.tenant_id = b.tenant_id
       LEFT JOIN clients  c ON c.id = b.client_id AND c.tenant_id = b.tenant_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.rental_id IS NOT NULL AND b.created_at::date BETWEEN $2 AND $3
      ORDER BY b.created_at DESC`,
    [tenant_id, f, t], []);
  const totals = rows.reduce((a, r) => ({ faturado: a.faturado + num(r.final_amount), recebido: a.recebido + num(r.paid_amount) }), { faturado: 0, recebido: 0 });
  return { from: f, to: t, rows, totals };
};

// Relatório de locações por período/status.
const rentalsReport = async (tenant_id, { from, to, status } = {}) => {
  const params = [tenant_id];
  let where = 'WHERE r.tenant_id = $1';
  if (from) { params.push(String(from).substring(0, 10)); where += ` AND r.start_date >= $${params.length}`; }
  if (to)   { params.push(String(to).substring(0, 10));   where += ` AND r.start_date <= $${params.length}`; }
  if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  const rows = await q(
    `SELECT r.rental_number, r.status, r.start_date, r.end_date, r.total_amount, r.deposit_amount,
            c.name AS client_name, v.plate AS vehicle_plate
       FROM rentals r
       LEFT JOIN clients  c ON c.id = r.client_id  AND c.tenant_id = r.tenant_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.tenant_id = r.tenant_id
      ${where} ORDER BY r.start_date DESC`,
    params, []);
  const total = rows.reduce((a, r) => a + num(r.total_amount), 0);
  return { rows, total };
};

// Utilização da frota (por status).
const fleetUtilization = async (tenant_id) => {
  const rows = await q('SELECT status, COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1 GROUP BY status', [tenant_id], []);
  const total = rows.reduce((a, r) => a + num(r.n), 0);
  const alugados = num((rows.find((r) => r.status === 'alugado') || {}).n);
  return { rows, total, taxa_ocupacao: total ? Math.round((alugados / total) * 100) : 0 };
};

module.exports = { overview, revenue, rentalsReport, fleetUtilization };
