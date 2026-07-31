// =============================================================================
// navigation.js — FONTE ÚNICA da navegação do app (áreas, telas, títulos, roles).
//
// Por que existe: sidebar (app/components/Sidebar.jsx), roteador de telas
// (app/dashboard/page.jsx) e cabeçalho (app/components/PageHeader.jsx) mantinham
// LISTAS SEPARADAS de tabs. Elas divergiram e a área central ficou em branco
// (item da sidebar apontando para uma tela que não existia no roteador).
// Agora os três leem daqui, e backend/tests/navigation.test.js quebra o build
// se um item de menu ficar sem tela correspondente.
//
// Campos de cada item:
//   key      — id do item na sidebar
//   tab      — valor do query param ?tab= (é a CHAVE da tela no roteador)
//   label    — texto do menu
//   icon     — nome do ícone (resolvido em Sidebar.jsx)
//   roles    — [opcional] perfis que enxergam o item; ausente = todos
//   title    — título exibido na topbar
//   subtitle — subtítulo exibido na topbar
// =============================================================================

// ── Áreas do produto ────────────────────────────────────────────────────────
// A visibilidade por tenant vem de tenant.modules; sem isso, todas aparecem.
export const NAV_MODULES = [
  { key: 'locacao',    label: 'Locação' },
  { key: 'multas',     label: 'Processos' },
  { key: 'financeiro', label: 'Financeiro', roles: ['admin'] },
];

// ── Itens por área ──────────────────────────────────────────────────────────
export const NAV_ITEMS = {
  // ── Locação (LocaCore: operação da locadora de veículos) ─────────────────
  locacao: [
    { key: 'painel',      tab: 'painel',      label: 'Painel',      icon: 'Dashboard', roles: ['admin', 'manager'],
      title: 'Painel',      subtitle: 'Visão geral da operação — frota, locações, agenda e financeiro.' },
    { key: 'locacoes',    tab: 'locacoes',    label: 'Locações',    icon: 'Key',
      title: 'Locações',    subtitle: 'Reservas, retiradas, devoluções, adicionais e cobrança.' },
    { key: 'frota',       tab: 'frota',       label: 'Frota',       icon: 'Car',
      title: 'Frota',       subtitle: 'Veículos, disponibilidade, quilometragem e histórico.' },
    { key: 'manutencoes', tab: 'manutencoes', label: 'Manutenções', icon: 'Wrench',
      title: 'Manutenções', subtitle: 'Preventivas, corretivas e revisões — com bloqueio do veículo.' },
    { key: 'multas',      tab: 'multas',      label: 'Multas',      icon: 'Shield',
      title: 'Multas',      subtitle: 'Infrações vinculadas a veículos, locações e condutores.' },
    { key: 'estoque',     tab: 'estoque',     label: 'Estoque',     icon: 'Layers',
      title: 'Estoque',     subtitle: 'Itens, movimentações, saldo e nível mínimo.' },
    { key: 'agenda',      tab: 'agenda',      label: 'Agenda',      icon: 'Calendar',
      title: 'Agenda',      subtitle: 'Retiradas, devoluções, manutenções e compromissos.' },
    { key: 'relatorios',  tab: 'relatorios',  label: 'Relatórios',  icon: 'BarChart', roles: ['admin', 'manager'],
      title: 'Relatórios',  subtitle: 'Faturamento, locações e ocupação da frota — com exportação CSV.' },
    { key: 'importacao',  tab: 'importacao',  label: 'Importação',  icon: 'Upload',   roles: ['admin', 'manager'],
      title: 'Importação',  subtitle: 'Carga inicial de clientes e veículos por CSV, com validação linha a linha.' },
    { key: 'clients',     tab: 'clients',     label: 'Clientes',    icon: 'Clients',
      title: 'Clientes',    subtitle: 'Locatários, documentos e histórico de locações.' },
    { key: 'automacoes',  tab: 'automacoes',  label: 'Automações',  icon: 'Zap',      roles: ['admin'],
      title: 'Automações',  subtitle: 'Cobrança automática, mensagens, fiscal, fila e execuções.' },
    { key: 'usuarios',    tab: 'usuarios',    label: 'Usuários',    icon: 'Clients',  roles: ['admin', 'manager'],
      title: 'Usuários',    subtitle: 'Acessos, perfis e permissões da equipe.' },
    { key: 'history',     tab: 'history',     label: 'Histórico',   icon: 'Clock',    roles: ['admin'],
      title: 'Histórico',   subtitle: 'Registro completo de atividades e alterações.' },
    { key: 'configuracoes', tab: 'configuracoes', label: 'Configurações', icon: 'Settings', roles: ['admin'],
      title: 'Configurações', subtitle: 'Empresa, equipe, catálogos, contratos, financeiro e integrações.' },
  ],

  // ── Despachantes (operação: processos, clientes, agenda, leads) ──────────
  multas: [
    { key: 'dashboard',  tab: 'dashboard',  label: 'Dashboard',  icon: 'Dashboard', roles: ['admin'],
      title: 'Dashboard',  subtitle: 'Visão geral de clientes, serviços, prazos e etapas.' },
    { key: 'clients',    tab: 'clients',    label: 'Clientes',   icon: 'Clients',
      title: 'Clientes',   subtitle: 'Gerencie todos os clientes e seus processos.' },
    { key: 'companies',  tab: 'companies',  label: 'Empresas',   icon: 'Building',
      title: 'Empresas',   subtitle: 'Pessoas jurídicas, frota e processos vinculados.' },
    { key: 'deferidos',  tab: 'deferidos',  label: 'Deferidos',  icon: 'Award',
      title: 'Deferidos',  subtitle: 'Processos com resultado deferido — prova social.' },
    { key: 'leads',      tab: 'leads',      label: 'Leads',      icon: 'Target',
      title: 'Leads',      subtitle: 'Lista e cadastro de leads captados.' },
    { key: 'tarefas',    tab: 'tarefas',    label: 'Tarefas',    icon: 'Tasks',
      title: 'Tarefas',    subtitle: 'Quadro kanban de acompanhamento operacional dos leads.' },
    { key: 'calendario', tab: 'calendario', label: 'Prazos',     icon: 'Calendar',
      title: 'Prazos',     subtitle: 'Prazos dos processos por urgência.' },
    { key: 'eventos',    tab: 'eventos',    label: 'Agenda',     icon: 'CalEvent',
      title: 'Agenda',     subtitle: 'Eventos e agendamentos da equipe.' },
    { key: 'history',    tab: 'history',    label: 'Histórico',  icon: 'Clock',     roles: ['admin'],
      title: 'Histórico',  subtitle: 'Registro completo de atividades e alterações.' },
    { key: 'approvals',  tab: 'approvals',  label: 'Aprovações', icon: 'Approvals', roles: ['admin'],
      title: 'Aprovações', subtitle: 'Solicitações de exclusão aguardando aprovação.' },
  ],

  // ── Financeiro ───────────────────────────────────────────────────────────
  financeiro: [
    { key: 'visao',        tab: 'visao',        label: 'Visão Financeira', icon: 'BarChart', roles: ['admin'],
      title: 'Visão Financeira', subtitle: 'Indicadores, gráficos e desempenho financeiro por período.' },
    { key: 'caixa',        tab: 'caixa',        label: 'Caixa',            icon: 'Wallet',   roles: ['admin'],
      title: 'Caixa',            subtitle: 'Movimento semanal de entradas e saídas.' },
    { key: 'lancamentos',  tab: 'lancamentos',  label: 'Lançamentos',      icon: 'Layers',   roles: ['admin'],
      title: 'Lançamentos',      subtitle: 'Entradas e saídas financeiras — manuais e automáticas.' },
    { key: 'faturamentos', tab: 'faturamentos', label: 'Faturamentos',     icon: 'Dollar',   roles: ['admin'],
      title: 'Faturamentos',     subtitle: 'Cobranças por locação ou serviço, pagamentos e saldos.' },
    { key: 'pagamentos',   tab: 'pagamentos',   label: 'Pagamentos',       icon: 'Card',     roles: ['admin'],
      title: 'Pagamentos',       subtitle: 'Todos os pagamentos registrados, parcelas e sinais.' },
    { key: 'recibos',      tab: 'recibos',      label: 'Recibos',          icon: 'Receipt',  roles: ['admin'],
      title: 'Recibos',          subtitle: 'Emissão, reemissão e histórico de recibos.' },
    { key: 'config',       tab: 'config',       label: 'Configurações',    icon: 'Settings', roles: ['admin'],
      title: 'Configurações Financeiras', subtitle: 'Identidade do recibo, numeração e formas de pagamento.' },
  ],

  // ── Configurações (fora do seletor de área; acesso pelo rodapé da sidebar) ─
  settings: [
    { key: 'general',      tab: 'general',      label: 'Geral',        icon: 'Settings',
      title: 'Configurações', subtitle: 'Empresa, contratos, categorias e aparência do sistema.' },
  ],

  // ── Leads (legado — URLs antigas continuam funcionando) ──────────────────
  leads: [
    { key: 'overview',    tab: 'overview',    label: 'Overview',    icon: 'Dashboard',
      title: 'Overview',    subtitle: 'Visão geral de leads e desempenho.' },
    { key: 'acquisition', tab: 'acquisition', label: 'Aquisição',   icon: 'Target',
      title: 'Aquisição',   subtitle: 'Gerenciamento e captação de novos leads.' },
    { key: 'pipeline',    tab: 'pipeline',    label: 'Pipeline',    icon: 'TrendingUp',
      title: 'Pipeline',    subtitle: 'Acompanhe o funil de vendas.' },
    { key: 'leaderboard', tab: 'leaderboard', label: 'Ranking',     icon: 'Award',
      title: 'Ranking',     subtitle: 'Desempenho e ranking da equipe.' },
    { key: 'performance', tab: 'performance', label: 'Performance', icon: 'BarChart',
      title: 'Performance', subtitle: 'Análise de performance e metas.' },
    { key: 'export',      tab: 'export',      label: 'Exportar',    icon: 'Download',
      title: 'Exportar',    subtitle: 'Exportação de dados e relatórios.' },
    { key: 'reports',     tab: 'reports',     label: 'Relatórios',  icon: 'File',
      title: 'Relatórios',  subtitle: 'Relatórios detalhados de vendas.' },
  ],
};

// Áreas que aparecem no seletor da sidebar (settings/leads ficam fora).
export const SIDEBAR_MODULE_KEYS = NAV_MODULES.map((m) => m.key);

// ── Aliases de URL (compatibilidade com links antigos) ──────────────────────
// MÓDULOS renomeados no overhaul anterior.
export const MODULE_ALIASES = { visao: 'multas', crm: 'multas', processos: 'multas' };

// TABS renomeadas — POR MÓDULO (nunca global). Um alias global de `painel` para
// `dashboard` era o que quebrava o Painel da Locação: o item existia no menu,
// mas o roteador procurava uma tela `dashboard` que não existe em `locacao`.
export const TAB_ALIASES = {
  multas: { painel: 'dashboard', home: 'dashboard' },
  financeiro: { resumo: 'visao' },
  locacao: { dashboard: 'painel', home: 'painel' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
export const getModuleItems = (moduleKey) => NAV_ITEMS[moduleKey] || [];

export const canSeeItem = (item, role) => !item.roles || item.roles.includes(role);

export const getVisibleItems = (moduleKey, role) =>
  getModuleItems(moduleKey).filter((i) => canSeeItem(i, role));

/** Resolve o módulo a partir do query param (aplica aliases). */
export const resolveModule = (raw) => {
  const key = raw || 'multas';
  return MODULE_ALIASES[key] || key;
};

/** Primeira tela visível do módulo para a role — usada como padrão e no seletor de área. */
export const getDefaultTab = (moduleKey, role) => {
  const visible = getVisibleItems(moduleKey, role);
  if (visible.length) return visible[0].tab;
  return getModuleItems(moduleKey)[0]?.tab || 'dashboard';
};

/** Resolve a tab a partir do query param, respeitando aliases DO MÓDULO. */
export const resolveTab = (moduleKey, rawTab, role) => {
  if (!rawTab) return getDefaultTab(moduleKey, role);
  const aliased = TAB_ALIASES[moduleKey]?.[rawTab] || rawTab;
  return aliased;
};

/** Título/subtítulo da topbar. Depende do MÓDULO (painel ≠ painel entre áreas). */
export const getPageInfo = (moduleKey, tab) => {
  const item = getModuleItems(moduleKey).find((i) => i.tab === tab);
  if (item) return { title: item.title, subtitle: item.subtitle };
  // Fallback: procura a tab em qualquer área (links legados entre módulos).
  for (const key of Object.keys(NAV_ITEMS)) {
    const found = NAV_ITEMS[key].find((i) => i.tab === tab);
    if (found) return { title: found.title, subtitle: found.subtitle };
  }
  return null;
};

/** A tab existe neste módulo? (não considera role — isso é checado à parte) */
export const tabExists = (moduleKey, tab) => getModuleItems(moduleKey).some((i) => i.tab === tab);

/** A role pode ver esta tab neste módulo? */
export const canAccessTab = (moduleKey, tab, role) => {
  const item = getModuleItems(moduleKey).find((i) => i.tab === tab);
  return !!item && canSeeItem(item, role);
};

// =============================================================================
// ÁREAS CONTRATADAS PELO TENANT
//
// `tenant.modules` lista as áreas que a empresa contratou. Ausente/vazio =
// todas habilitadas (compatível com os tenants antigos).
//
// Existe porque telas COMPARTILHADAS entre áreas (clientes, empresas, veículos)
// moram em rotas próprias fora do shell e voltavam com `?module=multas` fixo.
// Num tenant que só tem Locação, isso caía em "módulo não habilitado" — o
// usuário criava um cliente, entrava nele e não conseguia mais voltar.
// =============================================================================

/** Áreas habilitadas para o tenant, ou `null` quando todas valem. */
export const enabledModulesOf = (tenant) => {
  const mods = tenant?.modules;
  return Array.isArray(mods) && mods.length ? mods : null;
};

/** A área está habilitada para o tenant? (settings é interna: sempre sim) */
export const isModuleEnabled = (moduleKey, tenant) => {
  if (moduleKey === 'settings') return true;
  const enabled = enabledModulesOf(tenant);
  return !enabled || enabled.includes(moduleKey);
};

/** Primeira área contratada que a role enxerga — o "início" do tenant. */
export const getHomeModule = (tenant, role) => {
  const enabled = enabledModulesOf(tenant);
  const visiveis = NAV_MODULES.filter(
    (m) => (!m.roles || m.roles.includes(role)) && (!enabled || enabled.includes(m.key)),
  );
  return visiveis[0]?.key || (enabled ? enabled[0] : 'multas');
};

/**
 * Em qual área abrir uma TELA COMPARTILHADA (ex.: `clients`)?
 * Prioriza a área de origem quando ela é válida e contratada; senão, a primeira
 * área contratada que tenha essa tela. Nunca devolve uma área não contratada.
 */
export const resolveModuleForTab = (tab, { preferred, tenant, role } = {}) => {
  const candidatos = Object.keys(NAV_ITEMS).filter((m) => tabExists(m, tab));
  if (preferred && candidatos.includes(preferred) && isModuleEnabled(preferred, tenant)) {
    return preferred;
  }
  const habilitado = candidatos.find((m) => isModuleEnabled(m, tenant));
  return habilitado || getHomeModule(tenant, role);
};
