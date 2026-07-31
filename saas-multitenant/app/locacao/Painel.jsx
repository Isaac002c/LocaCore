'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getOverview, getDashboardSeries, getAlerts, getUpcoming } from '../lib/reportsAPI';
import { MetricCard, PageHead, Segmented, ChartCard } from '../components/ui';
import { PageLoading, PageError, EmptyState, InlineError } from '../components/states';
import { fmtMoney, fmtDate } from './shared';

// =============================================================================
// Painel do LocaCore (§2–§5) — HIERARQUIA, não parede de cards.
//
// Primeira dobra: 4 indicadores que respondem às perguntas de abertura do dia —
// tenho carro para locar? quantas locações rodando? tem atraso? tem valor a
// receber? Todo o resto desce um nível (abas Operação / Financeiro / Alertas).
//
// Alertas com contagem ZERO não ocupam espaço: o backend só devolve o que exige
// ação. Sem pendência, a lateral diz "Operação em dia".
//
// Todo cálculo vem do backend, filtrado por tenant. Nenhum número é inventado.
// =============================================================================

const hoje = () => new Date().toISOString().substring(0, 10);
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
};
const inicioDoMes = () => `${hoje().substring(0, 8)}01`;

const PERIODOS = [
  { value: 'mes', label: 'Este mês' },
  { value: '7d',  label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
];
const rangeDe = (preset) => {
  if (preset === '7d')  return { from: shift(-6),  to: hoje() };
  if (preset === '30d') return { from: shift(-29), to: hoje() };
  if (preset === '90d') return { from: shift(-89), to: hoje() };
  return { from: inicioDoMes(), to: hoje() };
};

const ABAS = [
  { value: 'resumo',     label: 'Resumo' },
  { value: 'operacao',   label: 'Operação' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'alertas',    label: 'Alertas' },
];

const fmtDiaCurto = (iso) => {
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
};
const brDate = (iso) => String(iso).split('-').reverse().join('/');

const RENTAL_LABEL = {
  reservado: 'Reservado', em_andamento: 'Em andamento', atrasado: 'Atrasado',
  finalizado: 'Finalizado', cancelado: 'Cancelado',
};
const FLEET_LABEL = {
  disponivel: 'Disponível', alugado: 'Alugado', manutencao: 'Manutenção',
  inativo: 'Inativo', indisponivel: 'Indisponível',
};
const MOV_LABEL = { retirada: 'Retirada', devolucao: 'Devolução', reserva: 'Reserva', evento: 'Compromisso' };
const MOV_COR = {
  retirada: 'var(--info)', devolucao: 'var(--warning)',
  reserva: 'var(--primary)', evento: 'var(--text-muted)',
};
const SEV_LABEL = { critico: 'Crítico', atencao: 'Atenção', info: 'Informativo' };
const SEV_COR = { critico: 'var(--danger)', atencao: 'var(--warning)', info: 'var(--text-muted)' };

// ── Barras horizontais (sem dependência de biblioteca de gráfico) ───────────
function BarList({ rows, valueFmt = (v) => v, emptyText }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.valor)), 0);
  if (!rows.length || max === 0) return <EmptyState small title="Sem dados" description={emptyText} />;
  return (
    <div className="nx-barlist">
      {rows.map((r) => (
        <div className="nx-barlist-row" key={r.label}>
          <span className="nx-barlist-label" title={r.label}>{r.label}</span>
          <span className="nx-barlist-track">
            <span className="nx-barlist-fill" style={{ width: `${Math.max((Math.abs(r.valor) / max) * 100, 2)}%`, background: r.color || 'var(--primary)' }} />
          </span>
          <span className="nx-barlist-value">{valueFmt(r.valor)}</span>
        </div>
      ))}
    </div>
  );
}

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

// ── Lista de alertas priorizados ────────────────────────────────────────────
function ListaAlertas({ dados, onAbrir, compacta = false }) {
  const lista = dados?.alertas || [];
  const visiveis = compacta ? lista.filter((a) => a.severidade !== 'info').slice(0, 5) : lista;

  if (!visiveis.length) {
    return (
      <div className="nx-ok-state">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
        <strong>Operação em dia</strong>
        <span>Nenhuma pendência crítica encontrada.</span>
      </div>
    );
  }

  return (
    <ul className="nx-alertas">
      {visiveis.map((a) => (
        <li key={a.key}>
          <button type="button" className={`nx-alerta nx-alerta--${a.severidade}`} onClick={() => onAbrir(a)}>
            <span className="nx-alerta-marca" style={{ background: SEV_COR[a.severidade] }} aria-hidden="true" />
            <span className="nx-alerta-corpo">
              <span className="nx-alerta-topo">
                <strong>{a.titulo}</strong>
                <span className="nx-alerta-total">{a.total}</span>
              </span>
              <span className="nx-alerta-desc">{a.descricao}</span>
            </span>
            <span className="nx-alerta-sev" style={{ color: SEV_COR[a.severidade] }}>{SEV_LABEL[a.severidade]}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Próximos movimentos ─────────────────────────────────────────────────────
function ProximosMovimentos({ dados, onAbrir }) {
  const movs = dados?.movimentos || [];
  if (!movs.length) {
    return (
      <EmptyState
        small
        title="Nenhum movimento nos próximos 7 dias"
        description="Retiradas, devoluções e reservas aparecem aqui automaticamente conforme você cadastra locações."
      />
    );
  }
  return (
    <ul className="nx-movimentos">
      {movs.map((m, i) => (
        <li key={`${m.tipo}-${m.rental_id || m.event_id}-${i}`}>
          <button
            type="button"
            className={`nx-movimento${m.hoje ? ' is-hoje' : ''}`}
            onClick={() => onAbrir(m)}
            disabled={m.tipo === 'evento'}
          >
            <span className="nx-mov-data">
              <strong>{m.hoje ? 'Hoje' : brDate(m.data).slice(0, 5)}</strong>
            </span>
            <span className="nx-mov-tipo" style={{ color: MOV_COR[m.tipo] }}>{MOV_LABEL[m.tipo]}</span>
            <span className="nx-mov-info">
              <strong>{m.cliente}</strong>
              {m.veiculo && <span> · {m.veiculo}</span>}
            </span>
            {m.rental_number && <span className="nx-mov-num">{m.rental_number}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Painel() {
  const router = useRouter();
  const [ov, setOv] = useState(null);
  const [series, setSeries] = useState(null);
  const [alertas, setAlertas] = useState(null);
  const [proximos, setProximos] = useState(null);
  const [preset, setPreset] = useState('mes');
  const [aba, setAba] = useState('resumo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => rangeDe(preset), [preset]);

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      // O overview é o essencial; o resto é complementar e não derruba a tela.
      const [o, s, a, p] = await Promise.all([
        getOverview(range),
        getDashboardSeries(range).catch(() => null),
        getAlerts().catch(() => null),
        getUpcoming({ days: 7, limit: 12 }).catch(() => null),
      ]);
      setOv(o); setSeries(s); setAlertas(a); setProximos(p);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const go = (tab, params = {}) => {
    const qs = new URLSearchParams({ module: 'locacao', tab, ...params });
    router.push(`/dashboard?${qs.toString()}`);
  };
  const abrirAlerta = (a) => go(a.tab, a.params || {});
  const abrirMovimento = (m) => go('locacoes', m.rental_number ? { q: m.rental_number } : {});

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

  const baseVazia = (f.total || 0) === 0
    && ((r.reservado || 0) + (r.em_andamento || 0) + (r.atrasado || 0) + (r.finalizado || 0) + (r.cancelado || 0)) === 0;

  const periodoLabel = `${brDate(range.from)} a ${brDate(range.to)}`;
  const criticos = alertas?.resumo?.critico || 0;

  return (
    <div>
      <PageHead
        title="Painel"
        subtitle={`Operação da locadora · ${periodoLabel}`}
        actions={<Segmented options={PERIODOS} value={preset} onChange={setPreset} ariaLabel="Período do painel" />}
      />

      {error && ov && (
        <InlineError message={`Alguns dados podem estar desatualizados: ${error}`} onRetry={load} />
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
          {/* ── PRIMEIRA DOBRA: exatamente 4 indicadores (§2) ─────────────── */}
          <div className="nx-kpi-grid nx-kpi-grid--4">
            <MetricCard
              title="Disponíveis"
              value={f.disponivel ?? 0}
              subtitle={`de ${f.total ?? 0} veículos`}
              tooltip="Veículos prontos para locar agora"
              onClick={() => go('frota', { status: 'disponivel' })}
            />
            <MetricCard
              title="Locações ativas"
              value={r.ativas ?? 0}
              subtitle={`${r.reservado ?? 0} reservadas`}
              tooltip="Em andamento + atrasadas"
              onClick={() => go('locacoes', { status: 'em_andamento' })}
            />
            <MetricCard
              title="Atrasadas"
              value={r.atrasado ?? 0}
              direction={r.atrasado ? 'down' : undefined}
              subtitle={r.atrasado ? 'Exige contato' : 'Nenhuma'}
              tooltip="Locações com devolução vencida"
              onClick={() => go('locacoes', { status: 'atrasado' })}
            />
            <MetricCard
              title="Valor em aberto"
              value={fmtMoney(fin.valor_em_aberto ?? 0)}
              subtitle={fin.inadimplencia_valor ? `${fmtMoney(fin.inadimplencia_valor)} vencido` : 'Nada vencido'}
              direction={fin.inadimplencia_valor ? 'down' : undefined}
              tooltip="Total dos contratos ativos"
              onClick={() => go('locacoes')}
            />
          </div>

          {/* ── Abas: o detalhe desce um nível (§4) ───────────────────────── */}
          <div className="nx-tabs" role="tablist" aria-label="Seções do painel">
            {ABAS.map((t) => (
              <button
                key={t.value}
                role="tab"
                aria-selected={aba === t.value}
                className={`nx-tab${aba === t.value ? ' active' : ''}`}
                onClick={() => setAba(t.value)}
              >
                {t.label}
                {t.value === 'alertas' && criticos > 0 && <span className="nx-tab-badge">{criticos}</span>}
              </button>
            ))}
          </div>

          {/* ── RESUMO ────────────────────────────────────────────────────── */}
          {aba === 'resumo' && (
            <>
              <div className="nx-split">
                <section className="nx-split-main">
                  <h3 className="nx-block-title">Próximos movimentos</h3>
                  <p className="nx-block-sub">Retiradas, devoluções e reservas dos próximos 7 dias</p>
                  <ProximosMovimentos dados={proximos} onAbrir={abrirMovimento} />
                </section>
                <aside className="nx-split-side">
                  <h3 className="nx-block-title">Alertas prioritários</h3>
                  <p className="nx-block-sub">Só aparece o que exige ação</p>
                  <ListaAlertas dados={alertas} onAbrir={abrirAlerta} compacta />
                  {alertas?.resumo?.total > 0 && (
                    <button type="button" className="nx-link-btn" onClick={() => setAba('alertas')}>
                      Ver todos os alertas ({alertas.resumo.total})
                    </button>
                  )}
                </aside>
              </div>

              {/* Resumo financeiro compacto: 3 números, não 6 (§3) */}
              <h3 className="nx-block-title" style={{ marginTop: 24 }}>Financeiro do período</h3>
              <div className="nx-kpi-grid nx-kpi-grid--3">
                <MetricCard title="Faturado" value={fmtMoney(fin.faturado_periodo ?? 0)} subtitle={periodoLabel} onClick={() => setAba('financeiro')} />
                <MetricCard title="Recebido" value={fmtMoney(fin.recebido_periodo ?? 0)} subtitle="Pagamentos confirmados" onClick={() => setAba('financeiro')} />
                <MetricCard title="Pendente" value={fmtMoney(fin.pendente_periodo ?? 0)} direction={fin.pendente_periodo ? 'down' : undefined} subtitle="Faturado ainda não recebido" onClick={() => setAba('financeiro')} />
              </div>
            </>
          )}

          {/* ── OPERAÇÃO ──────────────────────────────────────────────────── */}
          {aba === 'operacao' && (
            <>
              <div className="nx-kpi-grid">
                <MetricCard title="Frota total" value={f.total ?? 0} subtitle={`${f.taxa_ocupacao ?? 0}% de ocupação`} onClick={() => go('frota')} />
                <MetricCard title="Alugados" value={f.alugado ?? 0} subtitle="Em locação agora" onClick={() => go('frota', { status: 'alugado' })} />
                <MetricCard title="Reservados" value={f.reservado ?? 0} subtitle="Com reserva em aberto" onClick={() => go('locacoes', { status: 'reservado' })} />
                <MetricCard title="Em manutenção" value={f.manutencao ?? 0} direction={f.manutencao ? 'down' : undefined} subtitle="Indisponíveis" onClick={() => go('manutencoes')} />
                <MetricCard title="Retiradas hoje" value={h.retiradas ?? 0} subtitle="Programadas" onClick={() => go('agenda')} />
                <MetricCard title="Devoluções hoje" value={h.devolucoes ?? 0} subtitle="Programadas" onClick={() => go('agenda')} />
                <MetricCard title="Compromissos hoje" value={h.compromissos ?? 0} subtitle="Agenda do dia" onClick={() => go('agenda')} />
                <MetricCard title="Manutenções abertas" value={mnt.abertas ?? 0} subtitle={`${mnt.vencidas ?? 0} vencida(s)`} onClick={() => go('manutencoes')} />
              </div>

              <h3 className="nx-block-title">Agenda dos próximos 7 dias</h3>
              <ProximosMovimentos dados={proximos} onAbrir={abrirMovimento} />
            </>
          )}

          {/* ── FINANCEIRO ────────────────────────────────────────────────── */}
          {aba === 'financeiro' && (
            <>
              <div className="nx-kpi-grid">
                <MetricCard title="Faturado" value={fmtMoney(fin.faturado_periodo ?? 0)} subtitle={periodoLabel} onClick={() => go('relatorios')} />
                <MetricCard title="Recebido" value={fmtMoney(fin.recebido_periodo ?? 0)} subtitle="Pagamentos confirmados" onClick={() => go('relatorios')} />
                <MetricCard title="Pendente" value={fmtMoney(fin.pendente_periodo ?? 0)} direction={fin.pendente_periodo ? 'down' : undefined} subtitle="Faturado não recebido" onClick={() => go('relatorios')} />
                <MetricCard title="Inadimplência" value={fmtMoney(fin.inadimplencia_valor ?? 0)} direction={fin.inadimplencia_valor ? 'down' : undefined} subtitle={`${fin.inadimplencia_qtd ?? 0} cobrança(s) vencida(s)`} onClick={() => go('relatorios')} />
                <MetricCard title="Valor em aberto" value={fmtMoney(fin.valor_em_aberto ?? 0)} subtitle="Contratos ativos" onClick={() => go('locacoes')} />
                <MetricCard title="Caução retida" value={fmtMoney(fin.caucao_retida ?? 0)} subtitle="Locações em curso" onClick={() => go('locacoes')} />
                <MetricCard title="Multas abertas" value={m.abertas ?? 0} subtitle={fmtMoney(m.valor || 0)} onClick={() => go('multas')} />
              </div>

              {/* Máximo de 3 gráficos, todos operacionais (§3) */}
              <div className="nx-chart-grid">
                <ChartCard title="Faturado x Recebido" subtitle="Por dia, no período selecionado" wide loading={loading && !series}>
                  <FaturadoRecebido serie={series?.faturado_recebido || []} />
                </ChartCard>
                <ChartCard title="Ocupação da frota" subtitle="Veículos por situação">
                  <BarList
                    rows={(series?.ocupacao_frota || []).map((x) => ({
                      label: FLEET_LABEL[x.status] || x.status, valor: x.total,
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
                      label: RENTAL_LABEL[x.status] || x.status, valor: x.total,
                      color: x.status === 'atrasado' ? 'var(--danger)'
                        : x.status === 'em_andamento' ? 'var(--primary)'
                          : x.status === 'reservado' ? 'var(--info)' : 'var(--text-muted)',
                    }))}
                    emptyText="Nenhuma locação registrada."
                  />
                </ChartCard>
              </div>
            </>
          )}

          {/* ── ALERTAS ───────────────────────────────────────────────────── */}
          {aba === 'alertas' && (
            <>
              <p className="nx-block-sub" style={{ marginBottom: 14 }}>
                Ordenados por prioridade. Clique para abrir a tela correspondente já filtrada.
                {alertas?.resumo?.total > 0 && ` · ${alertas.resumo.critico} crítico(s), ${alertas.resumo.atencao} de atenção, ${alertas.resumo.info} informativo(s).`}
              </p>
              <ListaAlertas dados={alertas} onAbrir={abrirAlerta} />

              {(e.abaixo_minimo > 0 || aut.mensagens_falha > 0) && (
                <div className="nx-kpi-grid" style={{ marginTop: 20 }}>
                  {e.abaixo_minimo > 0 && <MetricCard title="Estoque abaixo do mínimo" value={e.abaixo_minimo} direction="down" subtitle="Itens a repor" onClick={() => go('estoque')} />}
                  {aut.mensagens_falha > 0 && <MetricCard title="Mensagens com falha" value={aut.mensagens_falha} direction="down" subtitle={`${aut.mensagens_pendentes ?? 0} na fila`} onClick={() => go('automacoes')} />}
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>
            <button className="btn-primary" onClick={() => go('locacoes')}>Nova locação</button>
            <button className="btn-secondary" onClick={() => go('frota')}>Gerenciar frota</button>
            <button className="btn-secondary" onClick={() => go('relatorios')}>Relatórios</button>
            <button className="btn-secondary" onClick={load} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
          </div>
        </>
      )}
    </div>
  );
}
