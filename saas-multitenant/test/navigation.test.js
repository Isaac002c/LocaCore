// =============================================================================
// Navegação — a lógica pura que decide QUAL tela abrir.
//
// É o mesmo contrato coberto no backend, mas aqui exercitando o módulo de
// verdade (import ESM) em vez de ler o arquivo como texto.
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  NAV_MODULES, NAV_ITEMS, TAB_ALIASES, MODULE_ALIASES,
  resolveModule, resolveTab, getDefaultTab, getVisibleItems,
  getPageInfo, tabExists, canAccessTab,
} from '../app/lib/navigation';

describe('resolução de módulo', () => {
  it('usa "multas" quando não há parâmetro', () => {
    expect(resolveModule(null)).toBe('multas');
    expect(resolveModule('')).toBe('multas');
  });

  it('aplica aliases de URLs antigas', () => {
    expect(resolveModule('visao')).toBe('multas');
    expect(resolveModule('crm')).toBe('multas');
    expect(resolveModule('processos')).toBe('multas');
  });

  it('NÃO trata "agenda" como módulo (é uma tela da Locação)', () => {
    expect(MODULE_ALIASES.agenda).toBeUndefined();
    expect(resolveModule('agenda')).toBe('agenda');
  });

  it('deixa passar módulos válidos', () => {
    for (const m of NAV_MODULES) expect(resolveModule(m.key)).toBe(m.key);
  });
});

describe('resolução de tab (a regressão da tela em branco)', () => {
  it('locacao/painel continua sendo painel — NUNCA vira dashboard', () => {
    expect(resolveTab('locacao', 'painel', 'admin')).toBe('painel');
  });

  it('multas/painel continua indo para dashboard (link legado)', () => {
    expect(resolveTab('multas', 'painel', 'admin')).toBe('dashboard');
  });

  it('locacao/dashboard cai no Painel da locadora', () => {
    expect(resolveTab('locacao', 'dashboard', 'admin')).toBe('painel');
  });

  it('sem tab, usa a primeira tela visível para a role', () => {
    expect(resolveTab('locacao', null, 'admin')).toBe('painel');
    expect(resolveTab('locacao', null, 'seller')).toBe('locacoes');
  });

  it('tab desconhecida é preservada (o roteador mostra "tela não encontrada")', () => {
    expect(resolveTab('locacao', 'inexistente', 'admin')).toBe('inexistente');
    expect(tabExists('locacao', 'inexistente')).toBe(false);
  });

  it('todo alias aponta para uma tela que existe', () => {
    for (const [moduleKey, aliases] of Object.entries(TAB_ALIASES)) {
      for (const [de, para] of Object.entries(aliases)) {
        expect(tabExists(moduleKey, para), `${moduleKey}: ${de} → ${para}`).toBe(true);
      }
    }
  });
});

describe('visibilidade por perfil', () => {
  const perfis = ['admin', 'manager', 'operator', 'seller', 'viewer'];

  it('a tab padrão sempre existe e é acessível para a role', () => {
    for (const moduleKey of Object.keys(NAV_ITEMS)) {
      for (const role of perfis) {
        const tab = getDefaultTab(moduleKey, role);
        expect(tabExists(moduleKey, tab), `${moduleKey}/${tab}`).toBe(true);
        if (getVisibleItems(moduleKey, role).length) {
          expect(canAccessTab(moduleKey, tab, role), `${moduleKey}/${tab} role=${role}`).toBe(true);
        }
      }
    }
  });

  it('consultor não enxerga Painel, Relatórios, Automações nem Configurações', () => {
    const tabs = getVisibleItems('locacao', 'seller').map((i) => i.tab);
    for (const restrita of ['painel', 'relatorios', 'automacoes', 'usuarios', 'history', 'configuracoes']) {
      expect(tabs).not.toContain(restrita);
    }
    // Mas continua com a operação do dia a dia.
    for (const livre of ['locacoes', 'frota', 'clients']) expect(tabs).toContain(livre);
  });

  it('admin enxerga todas as telas da Locação', () => {
    expect(getVisibleItems('locacao', 'admin').length).toBe(NAV_ITEMS.locacao.length);
  });

  it('gerente enxerga Painel e Relatórios, mas não Automações', () => {
    const tabs = getVisibleItems('locacao', 'manager').map((i) => i.tab);
    expect(tabs).toContain('painel');
    expect(tabs).toContain('relatorios');
    expect(tabs).not.toContain('automacoes');
  });
});

describe('títulos da topbar', () => {
  it('toda tela do menu tem título e subtítulo úteis', () => {
    for (const [moduleKey, itens] of Object.entries(NAV_ITEMS)) {
      for (const item of itens) {
        const info = getPageInfo(moduleKey, item.tab);
        expect(info, `${moduleKey}/${item.tab}`).toBeTruthy();
        expect(info.title.length).toBeGreaterThan(2);
        expect(info.subtitle.length).toBeGreaterThan(10);
      }
    }
  });

  it('nenhuma tela da Locação herda o texto do módulo despachante', () => {
    for (const item of NAV_ITEMS.locacao) {
      expect(getPageInfo('locacao', item.tab).subtitle).not.toMatch(/prazos e etapas/i);
    }
  });

  it('o mesmo `tab` em módulos diferentes tem título próprio', () => {
    expect(getPageInfo('locacao', 'painel').title).toBe('Painel');
    expect(getPageInfo('multas', 'dashboard').title).toBe('Dashboard');
  });
});
