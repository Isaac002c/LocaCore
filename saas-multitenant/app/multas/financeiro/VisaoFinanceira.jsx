'use client';

// =============================================================================
// Visão Financeira — dashboard do módulo Financeiro.
// Filtro global de período (afeta TODOS os indicadores e gráficos), KPIs com
// comparação vs período anterior e 6 gráficos agregados no backend.
// =============================================================================

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getFinanceOverview, BILLING_STATUS_LABELS, PAYMENT_METHOD_LABELS,
} from '../../lib/financialAPI';
import { formatBRL, formatDate, isAdmin, AccessDenied } from './financeShared';
import { MetricCard, ChartCard, Segmented, Skeleton, ErrorState, PageHead } from '../../components/ui';
import { CashflowChart, BillingChart, StatusDonut, HBarChart, CategoryChart, CHART_COLORS } from './charts';

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mês' },
  { value: '30d', label: '30 dias' },
  { value: 'quarter', label: 'Trimestre' },
  { value: 'year', label: 'Ano' },
  { value: 'custom', label: 'Personalizado' },
];

export default function VisaoFinanceira() {
  const router = useRouter();
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const params = preset === 'custom'
        ? (custom.start && custom.end ? { start: custom.start, end: custom.end } : null)
        : { preset };
      if (!params) { setLoading(false); return; } // aguarda datas do personalizado
      setData(await getFinanceOverview(params));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [preset, custom]);

  useEffect(() => { if (isAdmin()) load(); else setLoading(false); }, [load]);

  if (!isAdmin()) return <AccessDenied />;

  const go = (tab, extra = '') => router.push(`/dashboard?module=financeiro&tab=${tab}${extra}`);
  const k = data?.kpis;
  const charts = data?.charts;
  const range = data?.period;
  const hasSeries = (arr) => Array.isArray(arr) && arr.some((r) =>
    Object.values(r).some((v) => typeof v === 'number' && v !== 0));

  return (
    <div className="clients-page">
      <PageHead
        title="Visão Financeira"
        subtitle={range ? `Período: ${formatDate(range.start)} — ${formatDate(range.end)} · comparado com ${formatDate(range.previous.start)} — ${formatDate(range.previous.end)}` : 'Selecione o período'}
      />

      {/* Filtro global de período */}
      <div className="nx-filterbar" role="group" aria-label="Filtro de período">
        <Segmented options={PRESETS} value={preset} onChange={setPreset} ariaLabel="Período" />
        {preset === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
              De{' '}
              <input type="date" value={custom.start} onChange={(e) => setCustom((p) => ({ ...p, start: e.target.value }))} />
            </label>
            <label style={{ fontSize: 12.5, color: 'var(--nx-ink-2)', fontWeight: 600 }}>
              até{' '}
              <input type="date" value={custom.end} onChange={(e) => setCustom((p) => ({ ...p, end: e.target.value }))} />
            </label>
          </div>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading || !data ? (
        <>
          <div className="nx-kpi-grid">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={96} />)}</div>
          <div className="nx-chart-grid">
            <div className="nx-chart-card nx-chart-card--wide"><Skeleton height={260} /></div>
            <div className="nx-chart-card"><Skeleton height={260} /></div>
            <div className="nx-chart-card"><Skeleton height={260} /></div>
          </div>
        </>
      ) : (
        <>
          {/* KPIs — variação vs período anterior; clique abre os registros */}
          <div className="nx-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <MetricCard title="Entradas" value={formatBRL(k.entradas.value)} change={k.entradas.change} direction="up"
              tooltip="Lançamentos de entrada no período (exclui cancelados)" onClick={() => go('lancamentos')} />
            <MetricCard title="Saídas" value={formatBRL(k.saidas.value)} change={k.saidas.change} direction="down"
              tooltip="Lançamentos de saída no período — aumento pede atenção" onClick={() => go('lancamentos')} />
            <MetricCard title="Saldo" value={formatBRL(k.saldo.value)} change={k.saldo.change} direction="up"
              tooltip="Entradas menos saídas do período" onClick={() => go('caixa')} />
            <MetricCard title="Faturado" value={formatBRL(k.faturado.value)} change={k.faturado.change} direction="up"
              tooltip="Total faturado (criado) no período" onClick={() => go('faturamentos')} />
            <MetricCard title="Recebido" value={formatBRL(k.recebido.value)} change={k.recebido.change} direction="up"
              tooltip="Pagamentos confirmados no período" onClick={() => go('pagamentos')} />
            <MetricCard title="Pendente" value={formatBRL(k.pendente.value)} change={k.pendente.change} direction="down"
              tooltip="Saldo a receber dos faturamentos do período — não é receita" onClick={() => go('faturamentos')} />
            <MetricCard title="Vencido" value={formatBRL(k.vencido.value)} change={k.vencido.change} direction="down"
              tooltip="Saldo vencido e não pago — prioridade de cobrança" onClick={() => go('faturamentos')} />
            <MetricCard title="Ticket médio" value={formatBRL(k.ticket_medio.value)} change={k.ticket_medio.change} direction="up"
              tooltip="Faturado ÷ quantidade de faturamentos" />
            <MetricCard title="Serviços faturados" value={k.servicos_faturados.value} change={k.servicos_faturados.change} direction="neutral"
              tooltip="Quantidade de faturamentos criados" onClick={() => go('faturamentos')} />
            <MetricCard title="Serviços pagos" value={k.servicos_pagos.value} change={k.servicos_pagos.change} direction="up"
              tooltip="Faturamentos quitados" onClick={() => go('faturamentos')} />
          </div>

          {/* Gráficos */}
          <div className="nx-chart-grid">
            <ChartCard wide title="Fluxo de caixa" subtitle="Entradas, saídas e saldo acumulado no período"
              empty={!hasSeries(charts.cashflow)} emptyText="Nenhum lançamento no período selecionado.">
              <CashflowChart data={charts.cashflow} />
            </ChartCard>

            <ChartCard wide title="Faturado × Recebido × Pendente" subtitle="Comparação por período"
              empty={!hasSeries(charts.billing)} emptyText="Nenhum faturamento ou pagamento no período.">
              <BillingChart data={charts.billing} />
            </ChartCard>

            <ChartCard title="Status dos faturamentos" subtitle="Distribuição por status financeiro"
              empty={!charts.status?.length} emptyText="Nenhum faturamento no período.">
              <StatusDonut data={charts.status} labels={BILLING_STATUS_LABELS} />
            </ChartCard>

            <ChartCard title="Formas de pagamento" subtitle="Valor recebido por forma"
              empty={!charts.methods?.length} emptyText="Nenhum pagamento no período.">
              <HBarChart
                data={(charts.methods || []).map((m) => ({ ...m, name: PAYMENT_METHOD_LABELS[m.method] || m.method }))}
                nameKey="name" color={CHART_COLORS.blue}
              />
            </ChartCard>

            <ChartCard title="Receita por tipo de serviço" subtitle="Quais serviços geram mais faturamento"
              empty={!charts.services?.length} emptyText="Nenhum serviço faturado no período.">
              <HBarChart data={charts.services} nameKey="service" color={CHART_COLORS.navy} />
            </ChartCard>

            <ChartCard title="Entradas e saídas por categoria" subtitle="Categorias com maior impacto"
              empty={!charts.categories?.length} emptyText="Nenhum lançamento categorizado no período.">
              <CategoryChart data={charts.categories} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
