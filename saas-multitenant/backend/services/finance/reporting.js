// =============================================================================
// reporting.js — Agregação temporal PURA para os gráficos financeiros.
//
// O SQL agrupa por data bruta (portável: Postgres real e pg-mem); este módulo
// faz o bucketing dia/semana/mês e o preenchimento de buckets vazios em JS.
// Sem I/O — 100% testável.
// =============================================================================

const { parseDateOnly, toISODate, addDays, getWeekRange } = require('./calc');

const GROUPS = ['day', 'week', 'month'];

// Normaliza o agrupamento pedido pela API.
function normalizeGroup(group) {
  return GROUPS.includes(group) ? group : 'day';
}

// Chave do bucket de uma data ('YYYY-MM-DD' | Date) para o agrupamento dado.
//   day   → '2026-07-10'
//   week  → '2026-07-06' (segunda-feira ISO da semana)
//   month → '2026-07-01' (primeiro dia do mês)
function bucketKey(date, group) {
  const d = parseDateOnly(date);
  if (Number.isNaN(d.getTime())) return null;
  if (group === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  if (group === 'week') return getWeekRange(d, 1).start;
  return toISODate(d);
}

// Lista ordenada de chaves de bucket cobrindo [start, end].
function bucketRange(start, end, group) {
  const keys = [];
  let cur = bucketKey(start, group);
  const last = bucketKey(end, group);
  if (!cur || !last) return keys;
  let guard = 0;
  while (cur <= last && guard < 1000) {
    keys.push(cur);
    const d = parseDateOnly(cur);
    if (group === 'month') cur = bucketKey(new Date(d.getFullYear(), d.getMonth() + 1, 1, 12), group);
    else cur = bucketKey(addDays(d, group === 'week' ? 7 : 1), group);
    guard++;
  }
  return keys;
}

// Rótulo curto pt-BR para exibição no eixo X.
function bucketLabel(key, group) {
  const [y, m, d] = String(key).split('-');
  if (group === 'month') {
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${nomes[parseInt(m, 10) - 1]}/${y.slice(2)}`;
  }
  if (group === 'week') return `sem ${d}/${m}`;
  return `${d}/${m}`;
}

// Constrói a série de fluxo de caixa a partir de linhas {d, type, total}.
// Retorna [{ key, label, entradas, saidas, saldo, saldoAcumulado }] com buckets vazios = 0.
function buildCashflowSeries(rows, start, end, group) {
  const g = normalizeGroup(group);
  const map = new Map();
  for (const r of rows || []) {
    const key = bucketKey(r.d, g);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { entradas: 0, saidas: 0 });
    const slot = map.get(key);
    if (r.type === 'entrada') slot.entradas += Number(r.total) || 0;
    else if (r.type === 'saida') slot.saidas += Number(r.total) || 0;
  }
  let acc = 0;
  return bucketRange(start, end, g).map((key) => {
    const slot = map.get(key) || { entradas: 0, saidas: 0 };
    const saldo = slot.entradas - slot.saidas;
    acc += saldo;
    return {
      key,
      label: bucketLabel(key, g),
      entradas: round2(slot.entradas),
      saidas: round2(slot.saidas),
      saldo: round2(saldo),
      saldoAcumulado: round2(acc),
    };
  });
}

// Série faturado × recebido × pendente por bucket.
// billedRows: {d, total, paid} por data de criação do faturamento.
// receivedRows: {d, total} por data de pagamento confirmado.
function buildBillingSeries(billedRows, receivedRows, start, end, group) {
  const g = normalizeGroup(group);
  const billed = new Map();
  for (const r of billedRows || []) {
    const key = bucketKey(r.d, g);
    if (!key) continue;
    if (!billed.has(key)) billed.set(key, { total: 0, paid: 0 });
    const slot = billed.get(key);
    slot.total += Number(r.total) || 0;
    slot.paid += Number(r.paid) || 0;
  }
  const received = new Map();
  for (const r of receivedRows || []) {
    const key = bucketKey(r.d, g);
    if (!key) continue;
    received.set(key, (received.get(key) || 0) + (Number(r.total) || 0));
  }
  return bucketRange(start, end, g).map((key) => {
    const b = billed.get(key) || { total: 0, paid: 0 };
    return {
      key,
      label: bucketLabel(key, g),
      faturado: round2(b.total),
      recebido: round2(received.get(key) || 0),
      pendente: round2(Math.max(0, b.total - b.paid)),
    };
  });
}

// Período anterior de mesma duração (para comparação de KPIs).
// Ex.: 01–07/jul → 24–30/jun.
function previousRange(start, end) {
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  const days = Math.round((e - s) / 86400000) + 1;
  return { start: toISODate(addDays(s, -days)), end: toISODate(addDays(s, -1)) };
}

// Variação percentual (null quando não comparável).
function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? 0 : null;
  return round2(((c - p) / Math.abs(p)) * 100);
}

// Resolve presets de período para {start, end} ('YYYY-MM-DD').
// Presets: today | week | month | 30d | quarter | year. Custom: passa start/end.
function resolvePeriod({ preset, start, end }, ref = new Date()) {
  const today = toISODate(parseDateOnly(ref));
  if (start && end) return { start: String(start).slice(0, 10), end: String(end).slice(0, 10) };
  const d = parseDateOnly(ref);
  switch (preset) {
    case 'today': return { start: today, end: today };
    case 'week': return getWeekRange(d, 1);
    case '30d': return { start: toISODate(addDays(d, -29)), end: today };
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3) * 3;
      return { start: toISODate(new Date(d.getFullYear(), q, 1, 12)), end: today };
    }
    case 'year': return { start: `${d.getFullYear()}-01-01`, end: today };
    case 'month':
    default:
      return { start: toISODate(new Date(d.getFullYear(), d.getMonth(), 1, 12)), end: today };
  }
}

// Agrupamento default conforme o tamanho do período (legibilidade dos gráficos).
function autoGroup(start, end) {
  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  const days = Math.round((e - s) / 86400000) + 1;
  if (days > 92) return 'month';
  if (days > 31) return 'week';
  return 'day';
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

module.exports = {
  normalizeGroup,
  bucketKey,
  bucketRange,
  bucketLabel,
  buildCashflowSeries,
  buildBillingSeries,
  previousRange,
  pctChange,
  resolvePeriod,
  autoGroup,
};
