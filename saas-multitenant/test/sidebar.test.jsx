// =============================================================================
// Sidebar — menu por perfil e por módulo contratado.
//
// Regressões cobertas:
//   · trocar de área levava um consultor para uma tela admin-only (items[0] fixo);
//   · o menu mostrava áreas que o tenant não contratou;
//   · item de menu apontando para tela inexistente (causa da tela em branco).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../app/components/Sidebar';
import { NAV_ITEMS, tabExists, getVisibleItems } from '../app/lib/navigation';

const onNavigate = vi.fn();
const props = (over = {}) => ({
  currentModule: 'locacao',
  currentTab: 'painel',
  onNavigate,
  collapsed: false,
  onToggleCollapse: () => {},
  mobileOpen: false,
  user: { name: 'Admin', role: 'admin' },
  tenant: { name: 'Rental Log', slug: 'rental-log', modules: ['locacao', 'financeiro'] },
  ...over,
});

beforeEach(() => onNavigate.mockReset());

describe('menu por perfil', () => {
  it('admin vê todas as telas da Locação', () => {
    render(<Sidebar {...props()} />);
    // Escopo no <nav>: o rodapé tem um atalho "Configurações" com o mesmo texto.
    const menu = within(screen.getByRole('navigation', { name: /navegação principal/i }));
    for (const item of NAV_ITEMS.locacao) {
      expect(menu.getByText(item.label), item.label).toBeInTheDocument();
    }
  });

  it('consultor NÃO vê Painel, Automações nem Configurações', () => {
    render(<Sidebar {...props({ user: { name: 'Vendedor', role: 'seller' } })} />);
    expect(screen.queryByText('Painel')).toBeNull();
    expect(screen.queryByText('Automações')).toBeNull();
    expect(screen.queryByText('Histórico')).toBeNull();
    // Continua vendo a operação do dia a dia.
    expect(screen.getByText('Locações')).toBeInTheDocument();
    expect(screen.getByText('Frota')).toBeInTheDocument();
  });

  it('gerente vê Relatórios e Importação, mas não Automações', () => {
    render(<Sidebar {...props({ user: { name: 'Gerente', role: 'manager' } })} />);
    expect(screen.getByText('Relatórios')).toBeInTheDocument();
    expect(screen.getByText('Importação')).toBeInTheDocument();
    expect(screen.queryByText('Automações')).toBeNull();
  });
});

describe('áreas contratadas pelo tenant', () => {
  it('mostra apenas as áreas de tenant.modules', () => {
    render(<Sidebar {...props()} />);
    expect(screen.getByRole('button', { name: 'Locação' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Processos' })).toBeNull();
  });

  it('sem tenant.modules, mostra todas as áreas (compatibilidade)', () => {
    render(<Sidebar {...props({ tenant: { name: 'X', slug: 'x' } })} />);
    expect(screen.getByRole('button', { name: 'Processos' })).toBeInTheDocument();
  });

  it('consultor não vê a área Financeiro (restrita a admin)', () => {
    render(<Sidebar {...props({ user: { name: 'V', role: 'seller' } })} />);
    expect(screen.queryByRole('button', { name: 'Financeiro' })).toBeNull();
  });
});

describe('troca de área', () => {
  it('leva para a primeira tela VISÍVEL da role — não para uma tela admin-only', async () => {
    render(<Sidebar {...props({ user: { name: 'V', role: 'seller' }, tenant: { name: 'X', slug: 'x' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Processos' }));
    const [, tab] = onNavigate.mock.calls[0];
    expect(tab).not.toBe('dashboard');           // dashboard de Processos é admin-only
    expect(getVisibleItems('multas', 'seller').map((i) => i.tab)).toContain(tab);
  });

  it('admin cai na primeira tela da área', async () => {
    render(<Sidebar {...props({ tenant: { name: 'X', slug: 'x' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Processos' }));
    expect(onNavigate).toHaveBeenCalledWith('multas', 'dashboard');
  });
});

describe('integridade do menu', () => {
  it('todo item clicado aponta para uma tela que existe', async () => {
    render(<Sidebar {...props()} />);
    const menu = within(screen.getByRole('navigation', { name: /navegação principal/i }));
    for (const item of NAV_ITEMS.locacao) {
      onNavigate.mockReset();
      await userEvent.click(menu.getByText(item.label));
      const [moduleKey, tab] = onNavigate.mock.calls[0];
      expect(tabExists(moduleKey, tab), `${item.label} → ${moduleKey}/${tab}`).toBe(true);
    }
  });

  it('marca a tela atual como página corrente', () => {
    render(<Sidebar {...props({ currentTab: 'frota' })} />);
    const menu = within(screen.getByRole('navigation', { name: /navegação principal/i }));
    const item = menu.getByText('Frota').closest('button');
    expect(item).toHaveAttribute('aria-current', 'page');
  });

  it('não marca item de outro módulo como atual', () => {
    render(<Sidebar {...props({ currentModule: 'financeiro', currentTab: 'visao' })} />);
    const itens = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(itens.length).toBeLessThanOrEqual(1);
  });
});

describe('identidade do tenant', () => {
  it('usa o nome da locadora quando não há logo', () => {
    render(<Sidebar {...props()} />);
    expect(screen.getByText('Rental Log')).toBeInTheDocument();
  });

  it('esconde os rótulos quando recolhida', () => {
    render(<Sidebar {...props({ collapsed: true })} />);
    expect(screen.queryByText('Locações')).toBeNull();
    // Mas o item continua acessível pelo title do botão.
    expect(screen.getByTitle('Locações')).toBeInTheDocument();
  });
});

describe('área NÃO contratada (regressão: usuário preso)', () => {
  // Chegar em ?module=multas num tenant que só tem Locação mostrava o conteúdo
  // bloqueado E o menu de Processos — sem caminho de volta.
  const soLocacao = { name: 'Rental Log', slug: 'rental-log', modules: ['locacao', 'financeiro'] };

  it('mostra o menu da área CONTRATADA, não o da área bloqueada', () => {
    render(<Sidebar {...props({ currentModule: 'multas', currentTab: 'clients', tenant: soLocacao })} />);
    const menu = within(screen.getByRole('navigation', { name: /navegação principal/i }));
    // Telas exclusivas da Locação aparecem...
    expect(menu.getByText('Frota')).toBeInTheDocument();
    expect(menu.getByText('Locações')).toBeInTheDocument();
    // ...e as exclusivas de Processos, não.
    expect(menu.queryByText('Deferidos')).toBeNull();
    expect(menu.queryByText('Aprovações')).toBeNull();
  });

  it('o seletor de área continua sem oferecer a área não contratada', () => {
    render(<Sidebar {...props({ currentModule: 'multas', tenant: soLocacao })} />);
    expect(screen.queryByRole('button', { name: 'Processos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Locação' })).toBeInTheDocument();
  });

  it('clicar em qualquer item leva para a área contratada', async () => {
    render(<Sidebar {...props({ currentModule: 'multas', tenant: soLocacao })} />);
    const menu = within(screen.getByRole('navigation', { name: /navegação principal/i }));
    await userEvent.click(menu.getByText('Frota'));
    const [moduleKey] = onNavigate.mock.calls[0];
    expect(moduleKey).toBe('locacao');
  });
});
