'use client';

// =============================================================================
// charts.jsx — Gráficos do módulo financeiro (recharts).
//
// Regras de design aplicadas (dataviz):
//   * Paleta validada (CVD/contraste): azul var(--nx-primary-hover), verde #15803d, âmbar #d97706.
//   * Cores por SIGNIFICADO: verde=recebido/entrada, âmbar=atenção/pendente/saída,
//     vermelho=vencido, azul=informativo/faturado, cinza=cancelado (sempre c/ rótulo).
//   * Linhas 2px, barras finas com pontas 4px, grid recessivo, 1 eixo só.
//   * Tooltip em todos; legenda quando ≥ 2 séries; estado vazio; responsivo.
// =============================================================================

import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';

export const CHART_COLORS = {
  blue: 'var(--nx-primary-hover)',
  green: '#15803d',
  amber: '#d97706',
  red: '#b91c1c',
  cyan: '#0891b2',
  gray: 'var(--text-secondary)',
  navy: '#16324f',
  grid: '#eef1f5',
  axis: 'var(--text-muted)',
};

export const STATUS_CHART_COLORS = {
  pago: CHART_COLORS.green,
  parcialmente_pago: CHART_COLORS.cyan,
  faturado: CHART_COLORS.blue,
  nao_faturado: CHART_COLORS.gray,
  vencido: CHART_COLORS.red,
  cancelado: CHART_COLORS.gray,
};

const fmtBRL = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCompact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR');
};

const AXIS = { fontSize: 11, fill: CHART_COLORS.axis };
const NX_TOOLTIP = {
  contentStyle: {
    borderRadius: 8, border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(15,23,42,.10)',
    fontSize: 12.5, padding: '8px 12px',
  },
  labelStyle: { fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 },
};
const LEGEND = { wrapperStyle: { fontSize: 12 }, iconType: 'circle', iconSize: 8 };

// 1) Fluxo de caixa: entradas × saídas (áreas) + saldo acumulado (linha navy).
export function CashflowChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
        <YAxis tick={AXIS} tickFormatter={fmtCompact} tickLine={false} axisLine={false} width={56} />
        <Tooltip {...NX_TOOLTIP} formatter={(v, name) => [fmtBRL(v), name]} />
        <Legend {...LEGEND} />
        <Area type="monotone" dataKey="entradas" name="Entradas" stroke={CHART_COLORS.green} strokeWidth={2} fill={CHART_COLORS.green} fillOpacity={0.10} />
        <Area type="monotone" dataKey="saidas" name="Saídas" stroke={CHART_COLORS.amber} strokeWidth={2} fill={CHART_COLORS.amber} fillOpacity={0.10} />
        <Line type="monotone" dataKey="saldoAcumulado" name="Saldo acumulado" stroke={CHART_COLORS.navy} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// 2) Faturado × recebido × pendente por bucket (barras agrupadas).
export function BillingChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: CHART_COLORS.grid }} />
        <YAxis tick={AXIS} tickFormatter={fmtCompact} tickLine={false} axisLine={false} width={56} />
        <Tooltip {...NX_TOOLTIP} formatter={(v, name) => [fmtBRL(v), name]} cursor={{ fill: 'rgba(148,163,184,.08)' }} />
        <Legend {...LEGEND} />
        <Bar dataKey="faturado" name="Faturado" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="recebido" name="Recebido" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="pendente" name="Pendente" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 3) Distribuição por status (rosca) — cores de STATUS com rótulo (nunca só cor).
export function StatusDonut({ data, labels }) {
  const rows = (data || []).map((r) => ({
    name: labels[r.status] || r.status,
    status: r.status,
    value: Number(r.total) || 0,
    count: r.count,
  })).filter((r) => r.value > 0 || r.count > 0);
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={240}>
      <PieChart>
        <Tooltip {...NX_TOOLTIP} formatter={(v, name, item) => [`${fmtBRL(v)} · ${item?.payload?.count ?? 0} fat.`, name]} />
        <Legend {...LEGEND} verticalAlign="bottom" />
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {rows.map((r) => <Cell key={r.status} fill={STATUS_CHART_COLORS[r.status] || CHART_COLORS.gray} />)}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

// 4/5) Barras horizontais de magnitude (1 série, 1 matiz — sem legenda).
export function HBarChart({ data, nameKey, valueKey = 'total', color = CHART_COLORS.navy, valueFormatter = fmtBRL }) {
  const rows = data || [];
  const height = Math.max(200, rows.length * 34 + 24);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={nameKey} tick={{ ...AXIS, fill: 'var(--text-secondary)' }} width={130} tickLine={false} axisLine={false} />
        <Tooltip {...NX_TOOLTIP} formatter={(v) => [valueFormatter(v), 'Total']} cursor={{ fill: 'rgba(148,163,184,.08)' }} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// 6) Entradas × saídas por categoria (2 séries → com legenda).
export function CategoryChart({ data }) {
  // Pivota: uma linha por categoria com colunas entrada/saida.
  const byCat = new Map();
  for (const r of data || []) {
    if (!byCat.has(r.category)) byCat.set(r.category, { category: r.category, entrada: 0, saida: 0 });
    byCat.get(r.category)[r.type] = Number(r.total) || 0;
  }
  const rows = Array.from(byCat.values())
    .sort((a, b) => (b.entrada + b.saida) - (a.entrada + a.saida))
    .slice(0, 8);
  const height = Math.max(200, rows.length * 40 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="category" tick={{ ...AXIS, fill: 'var(--text-secondary)' }} width={130} tickLine={false} axisLine={false} />
        <Tooltip {...NX_TOOLTIP} formatter={(v, name) => [fmtBRL(v), name]} cursor={{ fill: 'rgba(148,163,184,.08)' }} />
        <Legend {...LEGEND} />
        <Bar dataKey="entrada" name="Entradas" fill={CHART_COLORS.green} radius={[0, 4, 4, 0]} maxBarSize={14} />
        <Bar dataKey="saida" name="Saídas" fill={CHART_COLORS.amber} radius={[0, 4, 4, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
