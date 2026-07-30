'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getOverview, getDashboardSeries } from '../lib/reportsAPI';
import { MetricCard, PageHead, Segmented, ChartCard } from '../components/ui';
import { PageLoading, PageError, EmptyState } from '../components/states';
import { fmtMoney } from './shared';

// =============================================================================
// Painel do LocaCore — snapshot operacional + financeiro com dados REAIS do
// backend. Duas chamadas consolidadas: /api/reports/overview (indicadores) e
// /api/reports/dashboard-series (gráficos). Todo cálculo é feito no backend,
// filtrado por tenant (§5).
//
// Regras: zero é exibido como zero (nunca "—" nem número inventado); banco
// vazio mostra um estado vazio que diz o que cadastrar primeiro; erro mostra
// mensagem clara com "tentar novamente".
// =============================================================================

const hoje = () => new Date().toISOString().substring(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
};
const inicioDoMes = () => `${hoje().substring(0, 8)}01`;

const PERIODOS = [
  { value: 'mes',   label: 'Este mês' },
  { value: '7d',    label: '7 dias' },
  { value: '30d',   label: '30 dias' },
  { value: '90d',   label: '90 dias' },
];
const rangeDe = (preset) => {
  if (preset === '7d')  return { from: shift(-6),  to: hoje() };
  if (preset === '30d') return { from: shift(-29), to: hoje() };
  if (preset === '90d') return { from: shift(-89), to: hoje() };
  return { from: inicioDoMes(), to: hoje() };
};

const fmtDiaCurto = (iso) => {
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
};

// Rótulos legíveis para status vindos do banco.
const RENTAL_LABEL = {
  reservado: 'Reservado', em_andamento: 'Em andamento', atrasado: 'Atrasado',
  finalizado: 'Finalizado', cancelado: 'Cancelado',
};
const FLEET_LABEL = {
  disponivel: 'Disponível', alugado: 'Alugado', manutencao: 'Manutenção',
  inativo: 'Inativo', indisponivel: 'Indisponível',
};

// ── Barras horizontais simples (sem dependência de gráfico) ─────────────────
function BarList({ rows, valueFmt = (v) => v, emptyText }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.valor)), 0);
  if (!rows.length || max === 0) {
    return <EmptyState small title="Sem dados" description={emptyText} />;
  }
  return (
    <div className="nx-barlist">
      {rows.map((r) => (
        <div className="nx-barlist-row" key={r.label}>
          <span className="nx-barlist-label" title={r.label}>{r.label}</span>
          <span className="nx-barlist-track">
            <span
              className="nx-barlist-fill"
              style={{ width: `${max ? Math.max((Math.abs(r.valor) / max) * 100, 2) : 0}%`, background: r.color || 'var(--primary)' }}
            />
          </span>
          <span className="nx-barlist-value">{valueFmt(r.valor)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Faturado x Recebido por dia (barras agrupadas) ──────────────────────────
function FaturadoRecebido({ serie }) {
  const max = Math.max(...serie.flatMap((d) => [d.faturado, d.recebido]), 0);
  if (!serie.length || max === 0) {
    return <EmptyState small title="Sem movimento" description="Nenhum faturamento de locação neste período." />;
  }
  return (
    <div className="nx-bars">
      <div className="nx-bars-legend">
        <span><i style={{ background: 'var(--primary)' }} /> Faturado</span>
        <span><i style={{ background: 'var(--success)' }} /> Recebido</span>
      </div>
      <div className="nx-bars-plot">
        {serie.map((d) => (
          <div className="nx-bars-group" key={d.dia} title={`${fmtDiaCurto(d.dia)} · faturado ${fmtMoney(d.faturado)} · recebido ${fmtMoney(d.recebido)}`}>
            <div className="nx-bars-pair">
              <span className="nx-bars-bar" style={{ height: `${(d.faturado / max) * 100}%`, background: 'var(--primary)' }} />
              <span className="nx-bars-bar" style={{ height: `${(d.recebido / max) * 100}%`, background: 'var(--success)' }} />
            </div>
            <span className="nx-bars-x">{fmtDiaCurto(d.dia)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Painel() {
  const router = useRouter();
  const [ov, setOv] = useState(null);
  const [series, setSeries] = useState(null);
  const [preset, setPreset] = useState('mes');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => rangeDe(preset), [preset]);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      // Os gráficos são complementares: uma falha neles não derruba o Painel.
      const [o, s] = await Promise.all([
        getOverview(range),
        getDashboardSeries(range).catch(() => null),
      ]);
      setOv(o); setSeries(s);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // Navega já filtrado para a listagem correspondente (§5: cards clicáveis).
  const go = (tab, params = {}) => {
    const qs = new URLSearchParams({ module: 'locacao', tab, ...params });
    router.push(`/dashboard?${qs.toString()}`);
  };

  if (loading && !ov) return <PageLoading label="Carregando painel..." />;

  if (error && !ov) {
    return (
      <PageError
        title="Não foi possível carregar o painel"
        message="Os indicadores não puderam ser calculados agora."
        detail={error}
        onRetry={load}
      />
    );
  }

  const f = ov?.fleet || {}; const r = ov?.rentals || {}; const h = ov?.hoje || {};
  const m = ov?.multas || {}; const e = ov?.estoque || {}; const fin = ov?.financeiro || {};
  const mnt = ov?.manutencoes || {}; const aut = ov?.automacoes || {};

  // Base vazia = nenhum veículo E nenhuma locação. Nesse caso o painel explica
  // o que cadastrar primeiro em vez de mostrar uma parede de zeros.
  const baseVazia = (f.total || 0) === 0
    && (r.reservado + r.em_andamento + r.atrasado + r.finalizado + r.cancelado || 0) === 0;

  return (
    <div>
      <PageHead
        title="Painel"
        subtitle={`Operação da locadora · período ${range.from.split('-').reverse().join('/')} a ${range.to.split('-').reverse().join('/')}`}
        actions={<Segmented options={PERIODOS} value={preset} onChange={setPreset} ariaLabel="Período do painel" />}
      />

      {error && ov && (
        <div className="nx-inline-error" role="alert">
          <span className="nx-inline-error-msg">Alguns dados podem estar desatualizados: {error}</span>
          <span className="nx-inline-error-actions">
            <button type="button" className="nx-inline-error-btn" onClick={load}>Atualizar</button>
          </span>
        </div>
      )}

      {baseVazia ? (
        <EmptyState
          title="Nenhum dado operacional ainda"
          description="Cadastre clientes, veículos e locações para começar a acompanhar os indicadores. Os números aparecem aqui automaticamente."
          actionLabel="Cadastrar primeiro veículo"
          onAction={() => go('frota')}
        />
      ) : (
        <>
          {/* ── Operação ────────────────────────────────────────────────── */}
          <div className="nx-section-label">Frota</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Frota total" value={f.total ?? 0} subtitle={`${f.taxa_ocupacao ?? 0}% de ocupação`} onClick={() => go('frota')} />
            <MetricCard title="Disponíveis" value={f.disponivel ?? 0} subtitle="Prontos para locar" onClick={() => go('frota', { status: 'disponivel' })} />
            <MetricCard title="Alugados" value={f.alugado ?? 0} subtitle="Em locação agora" onClick={() => go('frota', { status: 'alugado' })} />
            <MetricCard title="Reservados" value={f.reservado ?? 0} subtitle="Com reserva em aberto" onClick={() => go('locacoes', { status: 'reservado' })} />
            <MetricCard title="Em manutenção" value={f.manutencao ?? 0} direction={f.manutencao ? 'down' : undefined} subtitle="Indisponíveis" onClick={() => go('frota', { status: 'manutencao' })} />
          </div>

          <div className="nx-section-label">Locações e agenda</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Locações ativas" value={r.ativas ?? 0} subtitle={`${r.reservado ?? 0} reservadas`} onClick={() => go('locacoes', { status: 'em_andamento' })} />
            <MetricCard title="Atrasadas" value={r.atrasado ?? 0} direction={r.atrasado ? 'down' : undefined} subtitle="Devolução vencida" onClick={() => go('locacoes', { status: 'atrasado' })} />
            <MetricCard title="Retiradas hoje" value={h.retiradas ?? 0} subtitle="Programadas para hoje" onClick={() => go('agenda')} />
            <MetricCard title="Devoluções hoje" value={h.devolucoes ?? 0} subtitle="Programadas para hoje" onClick={() => go('agenda')} />
            <MetricCard title="Compromissos hoje" value={h.compromissos ?? 0} subtitle="Agenda do dia" onClick={() => go('agenda')} />
          </div>

          <div className="nx-section-label">Alertas operacionais</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Manutenções vencidas" value={mnt.vencidas ?? 0} direction={mnt.vencidas ? 'down' : undefined} subtitle="Data prevista passou" onClick={() => go('manutencoes')} />
            <MetricCard title="Manutenções próximas" value={mnt.proximas ?? 0} subtitle="Próximos 7 dias" onClick={() => go('manutencoes')} />
            <MetricCard title="Multas abertas" value={m.abertas ?? 0} direction={m.abertas ? 'down' : undefined} subtitle={fmtMoney(m.valor || 0)} onClick={() => go('multas')} />
            <MetricCard title="Estoque abaixo do mínimo" value={e.abaixo_minimo ?? 0} direction={e.abaixo_minimo ? 'down' : undefined} subtitle="Itens a repor" onClick={() => go('estoque')} />
            <MetricCard title="Mensagens com falha" value={aut.mensagens_falha ?? 0} direction={aut.mensagens_falha ? 'down' : undefined} subtitle={`${aut.mensagens_pendentes ?? 0} na fila`} onClick={() => go('automacoes')} />
            <MetricCard title="Fiscais pendentes" value={aut.fiscais_pendentes ?? 0} subtitle="Documentos a emitir" onClick={() => go('automacoes')} />
          </div>

          {/* ── Financeiro ──────────────────────────────────────────────── */}
          <div className="nx-section-label">Financeiro do período</div>
          <div className="nx-kpi-grid">
            <MetricCard title="Faturado" value={fmtMoney(fin.faturado_periodo ?? fin.faturado_mes ?? 0)} subtitle="Locações no período" onClick={() => go('relatorios')} />
            <MetricCard title="Recebido" value={fmtMoney(fin.recebido_periodo ?? fin.recebido_mes ?? 0)} subtitle="Pagamentos confirmados" onClick={() => go('relatorios')} />
            <MetricCard title="Pendente" value={fmtMoney(fin.pendente_periodo ?? 0)} direction={fin.pendente_periodo ? 'down' : undefined} subtitle="Faturado não recebido" onClick={() => go('relatorios')} />
            <MetricCard title="Inadimplência" value={fmtMoney(fin.inadimplencia_valor ?? 0)} direction={fin.inadimplencia_valor ? 'down' : undefined} subtitle={`${fin.inadimplencia_qtd ?? 0} cobrança(s) vencida(s)`} onClick={() => go('relatorios')} />
            <MetricCard title="Valor em aberto" value={fmtMoney(fin.valor_em_aberto ?? 0)} subtitle="Contratos ativos" onClick={() => go('locacoes')} />
            <MetricCard title="Caução retida" value={fmtMoney(fin.caucao_retida ?? 0)} subtitle="Locações em curso" onClick={() => go('locacoes')} />
          </div>

          {/* ── Gráficos ────────────────────────────────────────────────── */}
          <div className="nx-section-label">Análise</div>
          <div className="nx-chart-grid">
            <ChartCard
              title="Faturado x Recebido"
              subtitle="Por dia, no período selecionado"
              wide
              loading={loading && !series}
            >
              <FaturadoRecebido serie={series?.faturado_recebido || []} />
            </ChartCard>

            <ChartCard title="Ocupação da frota" subtitle="Veículos por situação">
              <BarList
                rows={(series?.ocupacao_frota || []).map((x) => ({
                  label: FLEET_LABEL[x.status] || x.status,
                  valor: x.total,
                  color: x.status === 'alugado' ? 'var(--primary)'
                    : x.status === 'disponivel' ? 'var(--success)'
                      : x.status === 'manutencao' ? 'var(--warning)' : 'var(--text-muted)',
                }))}
                emptyText="Nenhum veículo cadastrado."
              />
            </ChartCard>

            <ChartCard title="Locações por status" subtitle="Mix operacional atual">
              <BarList
                rows={(series?.locacoes_por_status || []).map((x) => ({
                  label: RENTAL_LABEL[x.status] || x.status,
                  valor: x.total,
                  color: x.status === 'atrasado' ? 'var(--danger)'
                    : x.status === 'em_andamento' ? 'var(--primary)'
                      : x.status === 'reservado' ? 'var(--info)' : 'var(--text-muted)',
                }))}
                emptyText="Nenhuma locação registrada."
              />
            </ChartCard>

            <ChartCard title="Inadimplência por faixa de atraso" subtitle="Saldo vencido em aberto">
              <BarList
                rows={(series?.inadimplencia_por_faixa || []).map((x) => ({
                  label: `${x.faixa} (${x.qtd})`, valor: x.total, color: 'var(--danger)',
                }))}
                valueFmt={fmtMoney}
                emptyText="Nenhuma cobrança vencida em aberto."
              />
            </ChartCard>

            <ChartCard title="Receita por veículo" subtitle="Top 10 no período" wide>
              <BarList
                rows={(series?.receita_por_veiculo || []).map((x) => ({
                  label: `${x.veiculo} · ${x.locacoes} locação(ões)`, valor: x.faturado,
                }))}
                valueFmt={fmtMoney}
                emptyText="Nenhum faturamento por veículo neste período."
              />
            </ChartCard>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
            <button className="btn-primary" onClick={() => go('locacoes')}>Nova locação</button>
            <button className="btn-secondary" onClick={() => go('frota')}>Gerenciar frota</button>
            <button className="btn-secondary" onClick={() => go('relatorios')}>Relatórios</button>
            <button className="btn-secondary" onClick={load} disabled={loading}>
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
