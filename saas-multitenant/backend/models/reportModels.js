const pool = require('../config/db');

// ============================================
// REPORTS MODEL (§ Dashboard/Relatórios) — agregações operacionais e financeiras
// da locadora. Tudo tenant-scoped. Cada consulta é tolerante (CASE WHEN, sem
// FILTER) e cai em default se uma tabela não existir no ambiente.
// ============================================

// Consulta tolerante: se uma tabela/coluna não existir no ambiente, o painel
// continua funcionando com o valor padrão. A falha é REGISTRADA — engolir em
// silêncio já escondeu gráfico vazio por incompatibilidade de SQL.
const q = async (sql, params, dflt) => {
  try { return (await pool.query(sql, params)).rows; }
  catch (err) {
    console.warn('[reports] consulta ignorada:', err.message, '| SQL:', sql.replace(/\s+/g, ' ').trim().slice(0, 120));
    return dflt;
  }
};
const num = (v) => Number(v) || 0;
const today = () => new Date().toISOString().substring(0, 10);
// DATE → 'YYYY-MM-DD'. O driver `pg` devolve DATE como objeto Date (o pg-mem
// devolve string): String(date).substring(0,10) daria "Wed Jul 29" e quebraria
// agrupamentos e cálculos de atraso. Getters LOCAIS para não deslocar o dia.
const iso = (v) => {
  if (v === '' || v === undefined || v === null) return '';
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).substring(0, 10);
};
const shift = (base, days) => {
  const d = new Date(`${iso(base)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
};
const monthStartOf = (t) => `${iso(t).substring(0, 8)}01`;

// Normaliza o período pedido pelo Painel/Relatórios. Padrão = mês corrente.
const resolvePeriod = ({ from, to } = {}) => {
  const t = today();
  return {
    from: from ? iso(from) : monthStartOf(t),
    to: to ? iso(to) : t,
  };
};

// Snapshot consolidado para o Painel (uma chamada, tudo por tenant e período).
// Os números financeiros respeitam o período; os operacionais são "agora".
const overview = async (tenant_id, periodo = {}) => {
  const t = today();
  const { from, to } = resolvePeriod(periodo);

  // ── Frota ────────────────────────────────────────────────────────────────
  const fleetRows = await q('SELECT status, COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1 GROUP BY status', [tenant_id], []);
  const fleet = { total: 0, disponivel: 0, alugado: 0, manutencao: 0, inativo: 0, indisponivel: 0, reservado: 0 };
  for (const r of fleetRows) { fleet.total += num(r.n); if (fleet[r.status] !== undefined) fleet[r.status] = num(r.n); }
  // "Reservado" não é um status da tabela vehicles: é derivado de uma reserva
  // futura em aberto. Contamos veículos distintos com reserva ativa.
  const reservados = await q(
    `SELECT COUNT(DISTINCT vehicle_id)::int AS n FROM rentals
      WHERE tenant_id = $1 AND status = 'reservado' AND vehicle_id IS NOT NULL`,
    [tenant_id], [{ n: 0 }]);
  fleet.reservado = num(reservados[0].n);
  fleet.taxa_ocupacao = fleet.total ? Math.round((fleet.alugado / fleet.total) * 100) : 0;

  // ── Locações ─────────────────────────────────────────────────────────────
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

  // ── Multas ───────────────────────────────────────────────────────────────
  const finesRow = await q(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount),0) AS total FROM rental_fines
      WHERE tenant_id = $1 AND status NOT IN ('paga','cancelada','encerrada')`,
    [tenant_id], [{ n: 0, total: 0 }]);

  // ── Estoque ──────────────────────────────────────────────────────────────
  const lowStock = await q(
    `SELECT COUNT(*)::int AS n FROM inventory_items WHERE tenant_id = $1 AND active = true AND quantity <= min_quantity`,
    [tenant_id], [{ n: 0 }]);

  // ── Manutenções (próximas 7 dias / vencidas) ─────────────────────────────
  const manutProximas = await q(
    `SELECT COUNT(*)::int AS n FROM vehicle_maintenances
      WHERE tenant_id = $1 AND status IN ('agendada','em_andamento')
        AND scheduled_date IS NOT NULL AND scheduled_date >= $2 AND scheduled_date <= $3`,
    [tenant_id, t, shift(t, 7)], [{ n: 0 }]);
  const manutVencidas = await q(
    `SELECT COUNT(*)::int AS n FROM vehicle_maintenances
      WHERE tenant_id = $1 AND status IN ('agendada','em_andamento')
        AND scheduled_date IS NOT NULL AND scheduled_date < $2`,
    [tenant_id, t], [{ n: 0 }]);
  const manutAbertas = await q(
    `SELECT COUNT(*)::int AS n FROM vehicle_maintenances
      WHERE tenant_id = $1 AND status IN ('agendada','em_andamento')`,
    [tenant_id], [{ n: 0 }]);

  // ── Financeiro do PERÍODO (faturamentos de locação) ──────────────────────
  const fin = await q(
    `SELECT COALESCE(SUM(final_amount),0) AS faturado, COALESCE(SUM(paid_amount),0) AS recebido
       FROM service_billings
      WHERE tenant_id = $1 AND rental_id IS NOT NULL AND created_at::date BETWEEN $2 AND $3`,
    [tenant_id, from, to], [{ faturado: 0, recebido: 0 }]);

  const openValue = await q(
    `SELECT COALESCE(SUM(total_amount),0) AS total, COALESCE(SUM(deposit_amount),0) AS caucao
       FROM rentals WHERE tenant_id = $1 AND status IN ('reservado','em_andamento','atrasado')`,
    [tenant_id], [{ total: 0, caucao: 0 }]);

  // Inadimplência: faturado com vencimento passado e saldo em aberto.
  const inadimplencia = await q(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(final_amount - paid_amount),0) AS total
       FROM service_billings
      WHERE tenant_id = $1 AND due_date IS NOT NULL AND due_date < $2
        AND final_amount > paid_amount
        AND financial_status NOT IN ('cancelado','pago')`,
    [tenant_id, t], [{ n: 0, total: 0 }]);

  // ── Automações (fila, falhas, fiscal) ────────────────────────────────────
  const msgFalha = await q(
    `SELECT COUNT(*)::int AS n FROM message_outbox WHERE tenant_id = $1 AND status IN ('failed','dead')`,
    [tenant_id], [{ n: 0 }]);
  const msgPend = await q(
    `SELECT COUNT(*)::int AS n FROM message_outbox WHERE tenant_id = $1 AND status = 'pending'`,
    [tenant_id], [{ n: 0 }]);
  const fiscalPend = await q(
    `SELECT COUNT(*)::int AS n FROM fiscal_documents
      WHERE tenant_id = $1 AND status IN ('pending','pending_configuration','processing','error')`,
    [tenant_id], [{ n: 0 }]);

  // ── Agenda do dia (eventos manuais + derivados de retirada/devolução) ────
  const eventosHoje = await q(
    `SELECT COUNT(*)::int AS n FROM calendar_events
      WHERE tenant_id = $1 AND event_date = $2 AND status NOT IN ('cancelado','concluido')`,
    [tenant_id, t], [{ n: 0 }]);

  const faturado = num(fin[0].faturado);
  const recebido = num(fin[0].recebido);

  return {
    periodo: { from, to },
    fleet,
    rentals,
    hoje: {
      retiradas: num(pickups[0].n),
      devolucoes: num(returns[0].n),
      compromissos: num(eventosHoje[0].n) + num(pickups[0].n) + num(returns[0].n),
      eventos: num(eventosHoje[0].n),
    },
    multas: { abertas: num(finesRow[0].n), valor: num(finesRow[0].total) },
    estoque: { abaixo_minimo: num(lowStock[0].n) },
    manutencoes: {
      abertas: num(manutAbertas[0].n),
      proximas: num(manutProximas[0].n),
      vencidas: num(manutVencidas[0].n),
    },
    automacoes: {
      mensagens_falha: num(msgFalha[0].n),
      mensagens_pendentes: num(msgPend[0].n),
      fiscais_pendentes: num(fiscalPend[0].n),
    },
    financeiro: {
      // Nomes *_mes preservados por compatibilidade; agora refletem o PERÍODO.
      faturado_mes: faturado, recebido_mes: recebido,
      faturado_periodo: faturado, recebido_periodo: recebido,
      pendente_periodo: Math.max(faturado - recebido, 0),
      valor_em_aberto: num(openValue[0].total), caucao_retida: num(openValue[0].caucao),
      inadimplencia_qtd: num(inadimplencia[0].n),
      inadimplencia_valor: num(inadimplencia[0].total),
    },
  };
};

// Séries para os gráficos do Painel. Tudo calculado no backend, por tenant.
const dashboardSeries = async (tenant_id, periodo = {}) => {
  const t = today();
  const { from, to } = resolvePeriod(periodo);

  // 1) Faturado x Recebido por dia do período.
  const finRows = await q(
    `SELECT created_at::date AS dia,
            COALESCE(SUM(final_amount),0) AS faturado,
            COALESCE(SUM(paid_amount),0)  AS recebido
       FROM service_billings
      WHERE tenant_id = $1 AND rental_id IS NOT NULL AND created_at::date BETWEEN $2 AND $3
      GROUP BY created_at::date ORDER BY created_at::date`,
    [tenant_id, from, to], []);
  const faturado_recebido = finRows.map((r) => ({
    dia: iso(r.dia), faturado: num(r.faturado), recebido: num(r.recebido),
  }));

  // 2) Locações por status (todas, para leitura do mix operacional).
  const statusRows = await q(
    'SELECT status, COUNT(*)::int AS n FROM rentals WHERE tenant_id = $1 GROUP BY status',
    [tenant_id], []);
  const locacoes_por_status = statusRows.map((r) => ({ status: r.status, total: num(r.n) }));

  // 3) Ocupação da frota (mix por status do veículo).
  const fleetRows = await q(
    'SELECT status, COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1 GROUP BY status',
    [tenant_id], []);
  const totalFrota = fleetRows.reduce((a, r) => a + num(r.n), 0);
  const ocupacao_frota = fleetRows.map((r) => ({
    status: r.status, total: num(r.n),
    percentual: totalFrota ? Math.round((num(r.n) / totalFrota) * 100) : 0,
  }));

  // 4) Inadimplência por faixa de atraso (aging).
  const agingRows = await q(
    `SELECT due_date, (final_amount - paid_amount) AS saldo
       FROM service_billings
      WHERE tenant_id = $1 AND due_date IS NOT NULL AND due_date < $2
        AND final_amount > paid_amount AND financial_status NOT IN ('cancelado','pago')`,
    [tenant_id, t], []);
  const faixas = [
    { faixa: '1-15 dias', min: 1, max: 15, total: 0, qtd: 0 },
    { faixa: '16-30 dias', min: 16, max: 30, total: 0, qtd: 0 },
    { faixa: '31-60 dias', min: 31, max: 60, total: 0, qtd: 0 },
    { faixa: '60+ dias', min: 61, max: Infinity, total: 0, qtd: 0 },
  ];
  for (const r of agingRows) {
    const dias = Math.floor((new Date(`${t}T00:00:00Z`) - new Date(`${iso(r.due_date)}T00:00:00Z`)) / 86400000);
    const f = faixas.find((x) => dias >= x.min && dias <= x.max);
    if (f) { f.total += num(r.saldo); f.qtd += 1; }
  }
  const inadimplencia_por_faixa = faixas.map(({ faixa, total, qtd }) => ({ faixa, total, qtd }));

  // 5) Receita por veículo no período (top 10) — quanto cada carro rendeu.
  // Sem GROUP BY de múltiplas colunas + COUNT(DISTINCT): a agregação é feita em
  // memória para não depender de dialeto (o volume é 1 linha por faturamento do
  // período, por tenant). Mantém o resultado idêntico em qualquer banco.
  const receitaRows = await q(
    `SELECT v.id AS vehicle_id, v.plate, v.brand, v.model,
            b.final_amount, b.paid_amount, r.id AS rental_id
       FROM service_billings b
       JOIN rentals  r ON r.id = b.rental_id AND r.tenant_id = b.tenant_id
       JOIN vehicles v ON v.id = r.vehicle_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1 AND b.created_at::date BETWEEN $2 AND $3`,
    [tenant_id, from, to], []);
  const porVeiculo = new Map();
  for (const row of receitaRows) {
    const key = String(row.vehicle_id);
    if (!porVeiculo.has(key)) {
      porVeiculo.set(key, {
        vehicle_id: row.vehicle_id,
        plate: row.plate,
        veiculo: [row.plate, [row.brand, row.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
        faturado: 0, recebido: 0, _rentals: new Set(),
      });
    }
    const acc = porVeiculo.get(key);
    acc.faturado += num(row.final_amount);
    acc.recebido += num(row.paid_amount);
    if (row.rental_id) acc._rentals.add(String(row.rental_id));
  }
  const receita_por_veiculo = [...porVeiculo.values()]
    .map(({ _rentals, ...v }) => ({ ...v, locacoes: _rentals.size }))
    .sort((a, b) => b.faturado - a.faturado)
    .slice(0, 10);

  return {
    periodo: { from, to },
    faturado_recebido,
    locacoes_por_status,
    ocupacao_frota,
    inadimplencia_por_faixa,
    receita_por_veiculo,
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

module.exports = { overview, dashboardSeries, revenue, rentalsReport, fleetUtilization, resolvePeriod };
