'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getOverview } from '../lib/reportsAPI';
import { MetricCard, PageHead } from '../components/ui';
import { fmtMoney } from './shared';

// Painel do LocaCore — snapshot operacional + financeiro com dados REAIS do
// backend (uma chamada consolidada: /api/reports/overview). Cada card navega
// para a listagem correspondente (§11).
export default function Painel() {
  const router = useRouter();
  const [ov, setOv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try { setLoading(true); setError(null); setOv(await getOverview()); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const go = (tab) => router.push(`/dashboard?module=locacao&tab=${tab}`);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 14 }}>
      <div className="loading-spinner" style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#2563eb' }} />
      <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando painel...</p>
    </div>
  );

  const f = ov?.fleet || {}; const r = ov?.rentals || {}; const h = ov?.hoje || {};
  const m = ov?.multas || {}; const e = ov?.estoque || {}; const fin = ov?.financeiro || {};

  return (
    <div>
      <PageHead title="Painel" subtitle="Visão geral da operação da locadora" />

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <p style={{ margin: 0 }}>{error}</p>
          <button onClick={() => setError(null)} className="btn-close">✕</button>
        </div>
      )}

      {/* Operação */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 0 10px' }}>Operação</div>
      <div className="nx-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard title="Frota" value={f.total ?? '—'} subtitle={`${f.disponivel ?? 0} disponíveis`} onClick={() => go('frota')} />
        <MetricCard title="Alugados" value={f.alugado ?? '—'} subtitle="Em locação" onClick={() => go('frota')} />
        <MetricCard title="Em manutenção" value={f.manutencao ?? '—'} subtitle="Frota" onClick={() => go('manutencoes')} />
        <MetricCard title="Locações ativas" value={r.ativas ?? 0} subtitle={`${r.reservado ?? 0} reservadas`} onClick={() => go('locacoes')} />
        <MetricCard title="Atrasadas" value={r.atrasado ?? 0} direction={r.atrasado ? 'down' : undefined} subtitle="Devolução vencida" onClick={() => go('locacoes')} />
        <MetricCard title="Retiradas hoje" value={h.retiradas ?? 0} subtitle="Agenda" onClick={() => go('agenda')} />
        <MetricCard title="Devoluções hoje" value={h.devolucoes ?? 0} subtitle="Agenda" onClick={() => go('agenda')} />
        <MetricCard title="Estoque baixo" value={e.abaixo_minimo ?? 0} direction={e.abaixo_minimo ? 'down' : undefined} subtitle="Abaixo do mínimo" onClick={() => go('estoque')} />
      </div>

      {/* Financeiro / multas */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 0 10px' }}>Financeiro</div>
      <div className="nx-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 20 }}>
        <MetricCard title="Faturado no mês" value={fmtMoney(fin.faturado_mes || 0)} subtitle="Locações" onClick={() => go('locacoes')} />
        <MetricCard title="Recebido no mês" value={fmtMoney(fin.recebido_mes || 0)} subtitle="Pagamentos" onClick={() => go('locacoes')} />
        <MetricCard title="Valor em aberto" value={fmtMoney(fin.valor_em_aberto || 0)} subtitle="Contratos ativos" onClick={() => go('locacoes')} />
        <MetricCard title="Caução retida" value={fmtMoney(fin.caucao_retida || 0)} subtitle="Locações em curso" onClick={() => go('locacoes')} />
        <MetricCard title="Multas abertas" value={m.abertas ?? 0} subtitle={fmtMoney(m.valor || 0)} onClick={() => go('multas')} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn-primary" onClick={() => go('locacoes')}>Nova locação</button>
        <button className="btn-secondary" onClick={() => go('frota')}>Gerenciar frota</button>
        <button className="btn-secondary" onClick={() => go('relatorios')}>Relatórios</button>
      </div>
    </div>
  );
}
