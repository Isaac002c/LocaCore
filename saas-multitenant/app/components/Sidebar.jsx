'use client';

import { useState } from 'react';
import Image from 'next/image';
import { PRODUCT_TAGLINE, PRODUCT_BRAND_COLOR, SUPPORT_EMAIL } from '../lib/brand';

const Icons = {
  Dashboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  Clients: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Building: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16"/>
      <path d="M19 21V9l-4-2"/>
      <line x1="9" y1="7" x2="11" y2="7"/><line x1="9" y1="11" x2="11" y2="11"/><line x1="9" y1="15" x2="11" y2="15"/>
    </svg>
  ),
  Shield: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  Clock: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Calendar: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  CalEvent: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <circle cx="12" cy="15" r="1.6" fill="currentColor"/>
    </svg>
  ),
  Settings: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93a10 10 0 0 0-14.14 0M4.93 19.07a10 10 0 0 0 14.14 0M2 12h2M20 12h2M12 2v2M12 20v2"/>
    </svg>
  ),
  ChevronLeft: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  ChevronRight: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  Target: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Tasks: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <polyline points="9 16 11 18 15 14"/>
    </svg>
  ),
  Approvals: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  TrendingUp: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  BarChart: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  ),
  Award: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="7"/>
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
    </svg>
  ),
  Download: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  File: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  Layers: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  ),
  Mail: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22 6 12 13 2 6"/>
    </svg>
  ),
  Dollar: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  Receipt: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/>
      <line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  ),
  Wallet: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
    </svg>
  ),
  Card: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  Home: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  Car: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17H3v-6l2-5h11l4 5h1a2 2 0 0 1 2 2v4h-2"/>
      <circle cx="7.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>
    </svg>
  ),
  Key: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>
    </svg>
  ),
  Zap: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
};

// =============================================================================
// Navegação: DUAS áreas — Despachantes (operação/processos) e Financeiro.
// Itens com roles[] = visíveis apenas para essas roles. Sem roles[] = todos.
// =============================================================================
const sidebarConfig = {
  // ── Locação (LocaCore: operação da locadora de veículos) ────────────────
  locacao: {
    label: 'Locação',
    items: [
      { key: 'painel',   label: 'Painel',    Icon: Icons.Dashboard, tab: 'painel', roles: ['admin'] },
      { key: 'locacoes', label: 'Locações',  Icon: Icons.Key,       tab: 'locacoes' },
      { key: 'frota',    label: 'Frota',     Icon: Icons.Car,       tab: 'frota' },
      { key: 'manutencoes', label: 'Manutenções', Icon: Icons.Settings, tab: 'manutencoes' },
      { key: 'multas',   label: 'Multas',    Icon: Icons.Shield,    tab: 'multas' },
      { key: 'estoque',  label: 'Estoque',   Icon: Icons.Layers,    tab: 'estoque' },
      { key: 'agenda',   label: 'Agenda',    Icon: Icons.Calendar,  tab: 'agenda' },
      { key: 'relatorios', label: 'Relatórios', Icon: Icons.BarChart, tab: 'relatorios', roles: ['admin', 'manager'] },
      { key: 'importacao', label: 'Importação', Icon: Icons.Layers, tab: 'importacao', roles: ['admin', 'manager'] },
      { key: 'clients',  label: 'Clientes',  Icon: Icons.Clients,   tab: 'clients' },
      { key: 'automacoes', label: 'Automações', Icon: Icons.Zap,    tab: 'automacoes', roles: ['admin'] },
      { key: 'usuarios', label: 'Usuários',  Icon: Icons.Clients,   tab: 'usuarios', roles: ['admin', 'manager'] },
      { key: 'history',  label: 'Histórico', Icon: Icons.Clock,     tab: 'history', roles: ['admin'] },
    ],
  },
  multas: {
    label: 'Processos',
    items: [
      { key: 'dashboard',  label: 'Dashboard',  Icon: Icons.Dashboard,  tab: 'dashboard',  roles: ['admin'] },
      { key: 'clients',    label: 'Clientes',   Icon: Icons.Clients,    tab: 'clients' },
      { key: 'companies',  label: 'Empresas',   Icon: Icons.Building,   tab: 'companies' },
      { key: 'deferidos',  label: 'Deferidos',  Icon: Icons.Award,      tab: 'deferidos' },
      { key: 'leads',      label: 'Leads',      Icon: Icons.Target,     tab: 'leads' },
      { key: 'tarefas',    label: 'Tarefas',    Icon: Icons.Tasks,      tab: 'tarefas' },
      { key: 'calendario', label: 'Prazos',     Icon: Icons.Calendar,   tab: 'calendario' },
      { key: 'eventos',    label: 'Agenda',     Icon: Icons.CalEvent,   tab: 'eventos' },
      { key: 'history',    label: 'Histórico',  Icon: Icons.Clock,      tab: 'history',    roles: ['admin'] },
      { key: 'approvals',  label: 'Aprovações', Icon: Icons.Approvals,  tab: 'approvals',  roles: ['admin'] },
    ],
  },
  financeiro: {
    label: 'Financeiro',
    items: [
      { key: 'visao',        label: 'Visão Financeira', Icon: Icons.BarChart, tab: 'visao',        roles: ['admin'] },
      { key: 'caixa',        label: 'Caixa',            Icon: Icons.Wallet,   tab: 'caixa',        roles: ['admin'] },
      { key: 'lancamentos',  label: 'Lançamentos',      Icon: Icons.Layers,   tab: 'lancamentos',  roles: ['admin'] },
      { key: 'faturamentos', label: 'Faturamentos',     Icon: Icons.Dollar,   tab: 'faturamentos', roles: ['admin'] },
      { key: 'pagamentos',   label: 'Pagamentos',       Icon: Icons.Card,     tab: 'pagamentos',   roles: ['admin'] },
      { key: 'recibos',      label: 'Recibos',          Icon: Icons.Receipt,  tab: 'recibos',      roles: ['admin'] },
      { key: 'config',       label: 'Configurações',    Icon: Icons.Settings, tab: 'config',       roles: ['admin'] },
    ],
  },
};

// Áreas do produto. A visibilidade por tenant é dada por tenant.modules (quando
// definido); sem isso, todas aparecem (compatível com os tenants atuais).
const modules = [
  { key: 'locacao', label: 'Locação' },
  { key: 'multas', label: 'Processos' },
  { key: 'financeiro', label: 'Financeiro', roles: ['admin'] },
];

// Sem branding fixo de clientes: a identidade vem dos dados do tenant (logo_url,
// brand_color, tagline). Quando ausente, usa o padrão do produto (LocaCore).
const TENANT_DEFAULTS = {};

function deriveSlug(name) {
  return (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
}

function TenantLogo({ collapsed, tenant }) {
  const name    = tenant?.name || 'Sistema';
  const slug    = tenant?.slug || deriveSlug(name);
  const defaults = TENANT_DEFAULTS[slug] || {};
  const logoUrl = tenant?.logo_url || defaults.logo_url || null;
  const tagline = tenant?.tagline  || defaults.tagline || PRODUCT_TAGLINE;
  const brandColor = tenant?.brand_color || defaults.brand_color || PRODUCT_BRAND_COLOR;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="sidebar-logo">
      <div className="cr-logo-icon" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={name}
            style={{ height: collapsed ? 28 : 34, width: 'auto', objectFit: 'contain', borderRadius: '6px' }}
            onError={e => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling.style.display = 'flex';
            }}
          />
        ) : null}
        {/* Fallback: initial letter */}
        <div style={{
          display: logoUrl ? 'none' : 'flex',
          width: collapsed ? 28 : 34,
          height: collapsed ? 28 : 34,
          borderRadius: '8px',
          background: brandColor,
          color: '#fff',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: collapsed ? 14 : 16,
          fontWeight: 800,
          flexShrink: 0,
        }}>
          {initial}
        </div>
      </div>
      {!collapsed && (
        <div className="sidebar-brand">
          <span className="sidebar-brand-name">{name}</span>
          <span className="sidebar-brand-sub">{tagline}</span>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ currentModule, currentTab, onNavigate, collapsed, onToggleCollapse, mobileOpen, user, tenant }) {
  // Módulo efetivo: Financeiro tem sidebar própria; qualquer outro cai no de Despachantes.
  const moduleKey = sidebarConfig[currentModule] ? currentModule : 'multas';
  const config   = sidebarConfig[moduleKey];
  const userRole = user?.role || 'seller';
  const tenantSlug = tenant?.slug || deriveSlug(tenant?.name) || 'default';

  // Filtra itens visíveis para a role atual. Restrições por item vêm de `roles[]`
  // no sidebarConfig — nada de regra fixa por tenant/slug no código (§14).
  const visibleItems = config.items.filter(item => {
    if (item.roles && !item.roles.includes(userRole)) return false;
    return true;
  });

  // Áreas habilitadas para o tenant (parametrizável). Sem tenant.modules → todas.
  const enabledModules = Array.isArray(tenant?.modules) && tenant.modules.length ? tenant.modules : null;
  const visibleModules = modules.filter(m =>
    (!m.roles || m.roles.includes(userRole)) &&
    (!enabledModules || enabledModules.includes(m.key))
  );

  const classes = [
    'sidebar',
    collapsed ? 'sidebar-collapsed' : '',
    mobileOpen ? 'sidebar-mobile-open' : '',
    `tenant-${tenantSlug}`,
  ].filter(Boolean).join(' ');

  return (
    <aside className={classes}>
      <TenantLogo collapsed={collapsed} tenant={tenant} />

      {collapsed && <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />}

      {/* Seletor de área: Despachantes / Financeiro */}
      {!collapsed && visibleModules.length > 1 && (
        <div className="sidebar-modules">
          {visibleModules.map(m => (
            <button
              key={m.key}
              className={`sidebar-module-btn${moduleKey === m.key ? ' active' : ''}`}
              onClick={() => onNavigate(m.key, sidebarConfig[m.key]?.items[0]?.tab || 'dashboard')}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-divider" />

      <nav className="sidebar-nav" aria-label="Navegação principal">
        {!collapsed && <span className="sidebar-section-label">{config.label}</span>}
        {visibleItems.map(item => {
          const isActive = currentTab === item.tab;
          return (
            <button
              key={item.key}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onNavigate(moduleKey, item.tab)}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="sidebar-item-icon"><item.Icon /></span>
              {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-divider" />
      <button
        className={`sidebar-item sidebar-item-settings${currentModule === 'settings' ? ' active' : ''}`}
        onClick={() => onNavigate('settings', 'general')}
        title={collapsed ? 'Configurações' : undefined}
      >
        <span className="sidebar-item-icon"><Icons.Settings /></span>
        {!collapsed && <span className="sidebar-item-label">Configurações</span>}
      </button>

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="sidebar-footer-support">
            <span className="sidebar-footer-label">
              <Icons.Mail /> Suporte
            </span>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="sidebar-footer-email">
              {SUPPORT_EMAIL}
            </a>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
        </button>
      </div>
    </aside>
  );
}
