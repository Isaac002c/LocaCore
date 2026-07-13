'use client';

// =============================================================================
// Visão Geral — dashboard EXECUTIVO do sistema.
// Leitura rápida da operação + ações contextuais que levam ao módulo dono do
// dado. Não substitui os dashboards de Processos nem do Financeiro.
// =============================================================================

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getClients } from '../lib/clientsAPI';
import { getContractDashboard } from '../lib/contractsAPI';
import { getEventsRange } from '../lib/calendarAPI';
import { getKanbanLeads } from '../lib/multasLeadsAPI';
import { getFinanceDashboard } from '../lib/financialAPI';
import { MetricCard, Skeleton, PageHead } from '../components/ui';
import UserHome from '../multas/UserHome';

const isoLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const fmtBRL = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function VisaoGeral() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ clients: [], contracts: {}, alerts: [], weekEvents: [], kanban: 0, fin: null });

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    setUser(u);
    if (u?.role !== 'admin') { setLoading(false); return; }
    (async () => {
      const today = new Date();
      const plus6 = new Date(); plus6.setDate(today.getDate() + 6);
      const [clients, contractsData, weekEvents, kanban, fin] = await Promise.all([
        getClients().catch(() => []),
        getContractDashboard().catch(() => ({})),
        getEventsRange(isoLocal(today), isoLocal(plus6)).catch(() => []),
        getKanbanLeads().catch(() => []),
        getFinanceDashboard().catch(() => null), // consultor/erro → oculta o bloco
      ]);
      setData({
        clients: clients || [],
        contracts: contractsData?.dashboard || contractsData || {},
        alerts: contractsData?.alerts || [],
        weekEvents: weekEvents || [],
        kanban: (kanban || []).length,
        fin,
      });
      setLoading(false);
    })();
  }, []);

  // Consultor: mantém a home operacional existente.
  if (user && user.role !== 'admin') return <UserHome user={user} />;

  if (loading) {
    return (
      <div className="clients-page">
        <PageHead title="Visão Geral" subtitle="Resumo executivo da operação" />
        <div className="nx-kpi-grid">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={96} />)}</div>
        <Skeleton height={84} />
      </div>
    );
  }

  const { clients, contracts, alerts, weekEvents, kanban, fin } = data;
  const clientesAtivos = clients.filter((c) => c.status === 'fechado').length;
  const emAndamento = parseInt(contracts?.active_contracts, 10) || 0;
  const prazos7 = alerts.find((a) => a.type === 'warning')?.count || 0;
  const vencidos = alerts.find((a) => a.type === 'danger')?.count || 0;
  const agendamentos = weekEvents.filter((e) => e.status !== 'cancelado' && e.type !== 'bloqueio').length;

  const go = (module, tab, extra = '') => router.push(`/dashboard?module=${module}&tab=${tab}${extra}`);

  return (
    <div className="clients-page">
      <PageHead title="Visão Geral" subtitle="Resumo executivo — clique em um indicador para abrir o módulo correspondente" />

      <div className="nx-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <MetricCard title="Clientes ativos" value={clientesAtivos} subtitle={`${clients.length} cadastrados`} onClick={() => go('crm', 'clients')} tooltip="Clientes com status fechado. Abrir CRM → Clientes" />
        <MetricCard title="Leads em negociação" value={kanban} subtitle="no funil comercial" onClick={() => go('crm', 'leads')} tooltip="Abrir CRM → Leads" />
        <MetricCard title="Processos em andamento" value={emAndamento} subtitle="em tramitação" onClick={() => go('processos', 'painel')} tooltip="Abrir Processos" />
        <MetricCard title="Prazos próximos" value={prazos7} subtitle="vencem em 7 dias" onClick={() => go('processos', 'calendario')} tooltip="Abrir Processos → Prazos" />
        <MetricCard title="Agendamentos" value={agendamentos} subtitle="próximos 7 dias" onClick={() => go('agenda', 'eventos')} tooltip="Abrir Agenda" />
      </div>

      {vencidos > 0 && (
        <div
          role="button" tabIndex={0}
          onClick={() => go('processos', 'calendario')}
          onKeyDown={(e) => e.key === 'Enter' && go('processos', 'calendario')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            background: 'rgba(185,28,28,.07)', border: '1px solid rgba(185,28,28,.25)',
            color: 'var(--nx-red)', borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            fontSize: 13.5, fontWeight: 600,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {vencidos} processo{vencidos !== 1 ? 's' : ''} com prazo vencido — abrir Prazos
        </div>
      )}

      {fin && (
        <div className="nx-mini-fin" style={{ marginBottom: 16 }}>
          <div className="nx-mini-fin-item">
            <div className="lbl">Saldo da semana</div>
            <div className="val">{fmtBRL(fin.week.saldo)}</div>
          </div>
          <div className="nx-mini-fin-item">
            <div className="lbl">Recebido no mês</div>
            <div className="val">{fmtBRL(fin.month.recebidos)}</div>
          </div>
          <div className="nx-mini-fin-item">
            <div className="lbl">Pendente</div>
            <div className="val">{fmtBRL(fin.month.pendentes)}</div>
          </div>
          <button className="btn-go" onClick={() => go('financeiro', 'visao')}>Acessar Financeiro →</button>
        </div>
      )}
    </div>
  );
}
