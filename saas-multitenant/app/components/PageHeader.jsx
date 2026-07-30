'use client';

import { getPageInfo } from '../lib/navigation';

// Telas legadas que não estão no menu, mas ainda podem ser abertas por URL.
const LEGACY_PAGE_INFO = {
  defesa:       { title: 'Defesa Prévia', subtitle: 'Processos em fase de defesa prévia.' },
  instancia1:   { title: '1ª Instância',  subtitle: 'Processos em primeira instância.' },
  instancia2:   { title: '2ª Instância',  subtitle: 'Processos em segunda instância.' },
  documents:    { title: 'Documentos',    subtitle: 'Gerencie documentos e arquivos dos processos.' },
  team:         { title: 'Equipe',        subtitle: 'Gerencie usuários, cargos e permissões.' },
  integrations: { title: 'Integrações',   subtitle: 'Configure integrações com outros sistemas.' },
};

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}

const ROLE_LABELS = { admin: 'ADMIN', manager: 'GERENTE', operator: 'OPERADOR', seller: 'CONSULTOR', viewer: 'LEITURA' };

export default function PageHeader({ currentModule, currentTab, user, tenant, onLogout, onMobileMenuToggle }) {
  const info = getPageInfo(currentModule, currentTab)
    || LEGACY_PAGE_INFO[currentTab]
    || { title: 'LocaCore', subtitle: '' };
  const role = user?.role;

  const getRoleBadge = () => {
    if (role === 'admin') {
      return { label: 'ADMIN', color: 'var(--primary)', bg: 'var(--primary-soft)', border: 'var(--border-strong)' };
    }
    return { label: ROLE_LABELS[role] || 'CONSULTOR', color: 'var(--text-secondary)', bg: 'var(--surface-secondary)', border: 'var(--border)' };
  };

  const badge = getRoleBadge();

  return (
    <header className="page-header">
      {onMobileMenuToggle && (
        <button className="ph-mobile-menu-btn" onClick={onMobileMenuToggle} aria-label="Abrir menu">
          <MenuIcon />
        </button>
      )}
      <div className="page-header-left">
        <h1 className="page-header-title">{info.title}</h1>
        <p className="page-header-subtitle">{info.subtitle}</p>
      </div>

      <div className="page-header-right">
        {tenant?.name && (
          <div className="ph-tenant-badge">
            <BuildingIcon />
            <span>{tenant.name}</span>
          </div>
        )}

        <div
          className="ph-role-badge"
          style={{ background: badge.bg, borderColor: badge.border, color: badge.color }}
        >
          {badge.label}
        </div>

        <div className="ph-avatar">
          {user?.name?.charAt(0).toUpperCase() || 'U'}
        </div>

        {user?.name && (
          <span className="ph-user-name">{user.name.split(' ')[0]}</span>
        )}

        <button onClick={onLogout} className="ph-logout-btn">
          <LogoutIcon />
          Sair
        </button>
      </div>
    </header>
  );
}
