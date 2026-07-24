'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';

// Leads
import LeadsOverview     from '../leads/Overview';
import LeadsAcquisition  from '../leads/Acquisition';
import LeadsPipeline     from '../leads/Pipeline';
import LeadsLeaderboard  from '../leads/Leaderboard';
import LeadsExport       from '../leads/Export';
import LeadsPerformance  from '../leads/Performance';
import LeadsReports      from '../leads/Reports';

// Multas
import MultasDashboard from '../multas/Dashboard';
import MultasClients   from '../multas/Clients';
import MultasCompanies from '../multas/Companies';
import MultasDeferidos from '../multas/Deferidos';
import CalendarioEventos from '../multas/CalendarioEventos';
import MultasHistory   from '../multas/History';
import MultasLeads     from '../multas/Leads';
import MultasLeadsList from '../multas/LeadsList';
import MultasTarefas   from '../multas/Tarefas';
import MultasApprovals from '../multas/Approvals';
import MultasAgenda    from '../multas/Calendario';

// Locação (LocaCore)
import LocacaoPainel   from '../locacao/Painel';
import Locacoes        from '../locacao/Locacoes';
import Frota           from '../locacao/Frota';
import Manutencoes     from '../locacao/Manutencoes';
import Multas          from '../locacao/Multas';
import Estoque         from '../locacao/Estoque';
import Agenda          from '../locacao/Calendario';
import Usuarios        from '../locacao/Usuarios';
import Relatorios      from '../locacao/Relatorios';
import Importacao      from '../locacao/Importacao';
import Automacoes      from '../locacao/Automacoes';

// Financeiro
import dynamic from 'next/dynamic';
import CaixaSemanal     from '../multas/financeiro/CaixaSemanal';
import Lancamentos      from '../multas/financeiro/Lancamentos';
import Faturamentos     from '../multas/financeiro/Faturamentos';
import Pagamentos       from '../multas/financeiro/Pagamentos';
import Recibos          from '../multas/financeiro/Recibos';
import ConfigFinanceira from '../multas/financeiro/ConfigFinanceira';
// Dashboard financeiro com gráficos (recharts) — lazy p/ não pesar o bundle geral
const VisaoFinanceira = dynamic(() => import('../multas/financeiro/VisaoFinanceira'), {
  loading: () => (
    <div className="loading-screen" style={{ height: 300 }}>
      <div className="loading-spinner" />
      <p>Carregando visão financeira...</p>
    </div>
  ),
  ssr: false,
});

// Settings
import SettingsPage from '../settings/page';

const ComingSoon = ({ moduleName }) => (
  <div className="coming-soon">
    <div style={{ marginBottom: 20 }}>
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
    <h2>{moduleName}</h2>
    <p>Esta seção está em desenvolvimento</p>
  </div>
);

const modulePages = {
  // ── Locação (LocaCore: operação da locadora de veículos) ───────────────
  locacao: {
    pages: {
      painel:    LocacaoPainel,
      locacoes:  Locacoes,
      frota:     Frota,
      manutencoes: Manutencoes,
      multas:    Multas,
      estoque:   Estoque,
      agenda:    Agenda,
      usuarios:  Usuarios,
      relatorios: Relatorios,
      clients:   MultasClients,  // reutiliza o módulo de clientes (locatários)
      automacoes: Automacoes,
      history:   MultasHistory,  // reutiliza o histórico/auditoria
    },
  },
  // ── Despachantes (operação: processos, clientes, agenda, leads) ────────
  multas: {
    pages: {
      dashboard:  MultasDashboard,
      clients:    MultasClients,
      companies:  MultasCompanies,
      leads:      MultasLeadsList,
      tarefas:    MultasTarefas,
      approvals:  MultasApprovals,
      history:    MultasHistory,
      calendario: MultasAgenda,
      eventos:    CalendarioEventos,
      deferidos:  MultasDeferidos,
      // legacy / coming-soon
      defesa:     () => <ComingSoon moduleName="Defesa Prévia" />,
      instancia1: () => <ComingSoon moduleName="1ª Instância" />,
      instancia2: () => <ComingSoon moduleName="2ª Instância" />,
      documents:  () => <ComingSoon moduleName="Documentos" />,
    },
  },
  // ── Financeiro (área própria) ──────────────────────────────────────────
  financeiro: {
    pages: {
      visao:        VisaoFinanceira,
      resumo:       VisaoFinanceira, // alias legado
      caixa:        CaixaSemanal,
      lancamentos:  Lancamentos,
      faturamentos: Faturamentos,
      pagamentos:   Pagamentos,
      recibos:      Recibos,
      config:       ConfigFinanceira,
    },
  },
  settings: {
    pages: {
      general:      SettingsPage,
      team:         () => <ComingSoon moduleName="Equipe" />,
      integrations: () => <ComingSoon moduleName="Integrações" />,
    },
  },
  // ── Módulo legado de Leads (URLs antigas continuam funcionando) ────────
  leads: {
    pages: {
      overview:    LeadsOverview,
      acquisition: LeadsAcquisition,
      pipeline:    LeadsPipeline,
      leaderboard: LeadsLeaderboard,
      export:      LeadsExport,
      performance: LeadsPerformance,
      reports:     LeadsReports,
    },
  },
};

// Aliases de módulos do overhaul anterior → Despachantes/Financeiro (URLs antigas).
const MODULE_ALIASES = { visao: 'multas', crm: 'multas', processos: 'multas', agenda: 'multas' };
const TAB_ALIASES = { painel: 'dashboard', home: 'dashboard' };

const getDefaultTab = (module) => {
  const defaults = { locacao: 'locacoes', leads: 'overview', multas: 'dashboard', financeiro: 'visao', settings: 'general' };
  return defaults[module] || 'dashboard';
};

function CachedTabs({ moduleKey, activeTab }) {
  const moduleData = modulePages[moduleKey] || modulePages.leads;
  const mountedRef = useRef({});

  return (
    <>
      {Object.entries(moduleData.pages).map(([key, Page]) => {
        const isActive = key === activeTab;
        if (!isActive && !mountedRef.current[key]) return null;
        mountedRef.current[key] = true;
        return (
          <div key={key} style={{ display: isActive ? 'block' : 'none' }}>
            <Page />
          </div>
        );
      })}
    </>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser]       = useState(null);
  const [tenant, setTenant]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const rawModule = searchParams.get('module') || 'multas';
  const currentModule = MODULE_ALIASES[rawModule] || rawModule;
  const rawTab    = searchParams.get('tab');
  const activeTab = (rawTab && (TAB_ALIASES[rawTab] || rawTab)) || getDefaultTab(currentModule);

  useEffect(() => {
    // Aceita token de localStorage (primário) ou cookie (fallback)
    const lsToken    = localStorage.getItem('auth-token') || localStorage.getItem('token');
    const cookieTok  = document.cookie.includes('auth-token');
    const hasToken   = !!(lsToken || cookieTok);
    const userData   = localStorage.getItem('user');
    const tenantData = localStorage.getItem('tenant');
    if (!hasToken || !userData) { router.push('/login'); return; }
    const parsedUser = JSON.parse(userData);
    // super_admin (operador da plataforma) não usa o dashboard de tenant — vai para o painel master.
    if (parsedUser?.role === 'super_admin') { router.replace('/master'); return; }
    setUser(parsedUser);
    setTenant(JSON.parse(tenantData || '{}'));
    setLoading(false);
  }, [router]);

  // Área inicial por tenant: se o tenant tem `modules` configurado e não usa o
  // módulo padrão (multas), leva para a primeira área habilitada. Não afeta
  // tenants sem `modules` (comportamento atual preservado).
  useEffect(() => {
    if (!tenant) return;
    const hasModuleParam = !!searchParams.get('module');
    const mods = Array.isArray(tenant.modules) ? tenant.modules : null;
    if (!hasModuleParam && mods && mods.length && !mods.includes('multas')) {
      router.replace(`/dashboard?module=${mods[0]}`);
    }
  }, [tenant, searchParams, router]);

  const handleLogout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {}
    finally {
      ['user', 'tenant', 'token', 'auth-token', 'tenantId', 'tenant-id'].forEach(k => localStorage.removeItem(k));
      ['token', 'auth-token', 'tenantId'].forEach(k => {
        document.cookie = `${k}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
      });
      router.push('/login');
    }
  };

  const handleNavigate = (moduleKey, tabKey) => {
    setMobileSidebarOpen(false);
    router.push(`/dashboard?module=${moduleKey}&tab=${tabKey}`);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Carregando LocaCore...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="sidebar-mobile-overlay"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <Sidebar
        currentModule={currentModule}
        currentTab={activeTab}
        onNavigate={handleNavigate}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        mobileOpen={mobileSidebarOpen}
        user={user}
        tenant={tenant}
      />

      <div className={`shell-main${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
        <PageHeader
          currentTab={activeTab}
          user={user}
          tenant={tenant}
          onLogout={handleLogout}
          onMobileMenuToggle={() => setMobileSidebarOpen(v => !v)}
        />
        <div className="shell-content">
          <CachedTabs moduleKey={currentModule} activeTab={activeTab} />
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Carregando...</p>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
