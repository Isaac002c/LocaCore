// =============================================================================
// Painel de Locação — comportamento visível (§2–§5).
//
// Cobre as regras que o ciclo de refinamento estabeleceu:
//   · no máximo 4 indicadores na primeira dobra;
//   · alerta com contagem ZERO não ocupa espaço;
//   · sem pendência, aparece "Operação em dia";
//   · base vazia explica o que cadastrar, sem inventar número;
//   · falha de API vira erro visível com "tentar novamente";
//   · card leva para a tela correspondente já filtrada.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getDashboardSeries: vi.fn(),
  getAlerts: vi.fn(),
  getUpcoming: vi.fn(),
}));
vi.mock('../app/lib/reportsAPI', () => api);

const { default: Painel } = await import('../app/locacao/Painel');

const overviewCheio = {
  periodo: { from: '2026-07-01', to: '2026-07-30' },
  fleet: { total: 10, disponivel: 4, alugado: 3, manutencao: 2, inativo: 1, reservado: 2, taxa_ocupacao: 30 },
  rentals: { reservado: 2, em_andamento: 3, atrasado: 1, finalizado: 5, cancelado: 0, ativas: 4 },
  hoje: { retiradas: 1, devolucoes: 2, compromissos: 4, eventos: 1 },
  multas: { abertas: 2, valor: 350 },
  estoque: { abaixo_minimo: 1 },
  manutencoes: { abertas: 2, proximas: 1, vencidas: 1 },
  automacoes: { mensagens_falha: 0, mensagens_pendentes: 3, fiscais_pendentes: 0 },
  financeiro: {
    faturado_periodo: 12000, recebido_periodo: 9000, pendente_periodo: 3000,
    valor_em_aberto: 15000, caucao_retida: 2000,
    inadimplencia_qtd: 2, inadimplencia_valor: 1800,
  },
};

const overviewVazio = {
  periodo: { from: '2026-07-01', to: '2026-07-30' },
  fleet: { total: 0, disponivel: 0, alugado: 0, manutencao: 0, inativo: 0, reservado: 0, taxa_ocupacao: 0 },
  rentals: { reservado: 0, em_andamento: 0, atrasado: 0, finalizado: 0, cancelado: 0, ativas: 0 },
  hoje: { retiradas: 0, devolucoes: 0, compromissos: 0, eventos: 0 },
  multas: { abertas: 0, valor: 0 },
  estoque: { abaixo_minimo: 0 },
  manutencoes: { abertas: 0, proximas: 0, vencidas: 0 },
  automacoes: { mensagens_falha: 0, mensagens_pendentes: 0, fiscais_pendentes: 0 },
  financeiro: {
    faturado_periodo: 0, recebido_periodo: 0, pendente_periodo: 0,
    valor_em_aberto: 0, caucao_retida: 0, inadimplencia_qtd: 0, inadimplencia_valor: 0,
  },
};

const alertasComPendencia = {
  alertas: [
    { key: 'locacoes_atrasadas', severidade: 'critico', total: 1, titulo: 'Locação atrasada', descricao: 'Devolução vencida.', tab: 'locacoes', params: { status: 'atrasado' } },
    { key: 'manutencoes_vencidas', severidade: 'critico', total: 1, titulo: 'Manutenção vencida', descricao: 'A data prevista já passou.', tab: 'manutencoes' },
    { key: 'estoque_baixo', severidade: 'atencao', total: 1, titulo: 'Estoque abaixo do mínimo', descricao: 'Itens a repor.', tab: 'estoque' },
    { key: 'retiradas_hoje', severidade: 'info', total: 1, titulo: 'Retirada programada hoje', descricao: 'Prepare o veículo.', tab: 'agenda' },
  ],
  resumo: { critico: 2, atencao: 1, info: 1, total: 4 },
  operacao_em_dia: false,
};

const semAlertas = { alertas: [], resumo: { critico: 0, atencao: 0, info: 0, total: 0 }, operacao_em_dia: true };

const upcomingCheio = {
  de: '2026-07-30', ate: '2026-08-06', total: 2, hoje: 1,
  movimentos: [
    { tipo: 'devolucao', data: '2026-07-30', rental_id: 'r1', rental_number: 'LOC-000001', cliente: 'Maria Oliveira', veiculo: 'RIO2A18 · Fiat Argo', status: 'em_andamento', hoje: true },
    { tipo: 'reserva', data: '2026-08-02', rental_id: 'r2', rental_number: 'LOC-000002', cliente: 'João Santos', veiculo: 'RIO3B29 · Onix', status: 'reservado', hoje: false },
  ],
};

const seriesVazia = {
  periodo: { from: '2026-07-01', to: '2026-07-30' },
  faturado_recebido: [], locacoes_por_status: [], ocupacao_frota: [],
  inadimplencia_por_faixa: [], receita_por_veiculo: [],
};

beforeEach(() => {
  push.mockReset();
  api.getOverview.mockResolvedValue(overviewCheio);
  api.getDashboardSeries.mockResolvedValue(seriesVazia);
  api.getAlerts.mockResolvedValue(alertasComPendencia);
  api.getUpcoming.mockResolvedValue(upcomingCheio);
});

describe('primeira dobra', () => {
  it('mostra EXATAMENTE 4 indicadores principais', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Disponíveis');
    const primeiraDobra = container.querySelector('.nx-kpi-grid--4');
    expect(primeiraDobra).toBeTruthy();
    expect(primeiraDobra.querySelectorAll('.nx-kpi')).toHaveLength(4);
  });

  it('responde às quatro perguntas de abertura do dia', async () => {
    render(<Painel />);
    await screen.findByText('Disponíveis');
    for (const titulo of ['Disponíveis', 'Locações ativas', 'Atrasadas', 'Valor em aberto']) {
      expect(screen.getByText(titulo)).toBeInTheDocument();
    }
    expect(screen.getByText('de 10 veículos')).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*15\.000,00/)).toBeInTheDocument();
  });

  it('card leva para a tela correspondente JÁ FILTRADA', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Atrasadas');
    const cardAtrasadas = within(container.querySelector('.nx-kpi-grid--4'))
      .getByText('Atrasadas').closest('.nx-kpi');
    await userEvent.click(cardAtrasadas);
    expect(push).toHaveBeenCalledWith(expect.stringContaining('tab=locacoes'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('status=atrasado'));
  });

  it('valor zero é exibido como zero, não escondido', async () => {
    api.getOverview.mockResolvedValue({
      ...overviewCheio,
      rentals: { ...overviewCheio.rentals, atrasado: 0 },
    });
    const { container } = render(<Painel />);
    await screen.findByText('Atrasadas');
    const card = within(container.querySelector('.nx-kpi-grid--4')).getByText('Atrasadas').closest('.nx-kpi');
    expect(within(card).getByText('0')).toBeInTheDocument();
    expect(within(card).getByText('Nenhuma')).toBeInTheDocument();
  });
});

describe('abas', () => {
  it('oferece Resumo, Operação, Financeiro e Alertas', async () => {
    render(<Painel />);
    await screen.findByText('Disponíveis');
    for (const aba of ['Resumo', 'Operação', 'Financeiro', 'Alertas']) {
      expect(screen.getByRole('tab', { name: new RegExp(aba) })).toBeInTheDocument();
    }
  });

  it('marca a aba Alertas com o número de críticos', async () => {
    render(<Painel />);
    const abaAlertas = await screen.findByRole('tab', { name: /Alertas/ });
    expect(abaAlertas).toHaveTextContent('2');
  });

  it('o Resumo NÃO despeja os seis números financeiros (só 3)', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Disponíveis');
    const compacto = container.querySelector('.nx-kpi-grid--3');
    expect(compacto.querySelectorAll('.nx-kpi')).toHaveLength(3);
    expect(screen.queryByText('Caução retida')).toBeNull();
  });

  it('a aba Financeiro traz o detalhe e no máximo 3 gráficos', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Disponíveis');
    await userEvent.click(screen.getByRole('tab', { name: /Financeiro/ }));
    expect(screen.getByText('Caução retida')).toBeInTheDocument();
    expect(container.querySelectorAll('.nx-chart-card').length).toBeLessThanOrEqual(3);
  });
});

describe('alertas dinâmicos', () => {
  it('mostra apenas o que exige ação, em ordem de prioridade', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Disponíveis');
    await userEvent.click(screen.getByRole('tab', { name: /Alertas/ }));
    const severidades = [...container.querySelectorAll('.nx-alerta-sev')].map((e) => e.textContent);
    expect(severidades).toEqual(['Crítico', 'Crítico', 'Atenção', 'Informativo']);
  });

  it('o resumo esconde os informativos (só o que precisa de ação)', async () => {
    const { container } = render(<Painel />);
    await screen.findByText('Alertas prioritários');
    const titulos = [...container.querySelectorAll('.nx-alerta-topo strong')].map((e) => e.textContent);
    expect(titulos).toContain('Locação atrasada');
    expect(titulos).not.toContain('Retirada programada hoje');
  });

  it('clicar num alerta abre a tela relacionada já filtrada', async () => {
    render(<Painel />);
    await screen.findByText('Alertas prioritários');
    await userEvent.click(screen.getByText('Locação atrasada').closest('button'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('status=atrasado'));
  });

  it('sem pendência, mostra "Operação em dia" em vez de lista vazia', async () => {
    api.getAlerts.mockResolvedValue(semAlertas);
    render(<Painel />);
    expect(await screen.findByText('Operação em dia')).toBeInTheDocument();
    expect(screen.getByText(/Nenhuma pendência crítica/)).toBeInTheDocument();
  });
});

describe('próximos movimentos', () => {
  it('lista retiradas, devoluções e reservas com o registro relacionado', async () => {
    render(<Painel />);
    expect(await screen.findByText('Maria Oliveira')).toBeInTheDocument();
    expect(screen.getByText('LOC-000001')).toBeInTheDocument();
    expect(screen.getByText('Devolução')).toBeInTheDocument();
    expect(screen.getByText('Reserva')).toBeInTheDocument();
  });

  it('destaca o que é de hoje', async () => {
    render(<Painel />);
    await screen.findByText('Maria Oliveira');
    expect(screen.getByText('Hoje')).toBeInTheDocument();
  });

  it('sem movimento, explica em vez de deixar vazio', async () => {
    api.getUpcoming.mockResolvedValue({ de: '', ate: '', total: 0, hoje: 0, movimentos: [] });
    render(<Painel />);
    expect(await screen.findByText(/Nenhum movimento nos próximos 7 dias/)).toBeInTheDocument();
  });
});

describe('estados da tela', () => {
  it('mostra carregamento antes dos dados', () => {
    api.getOverview.mockReturnValue(new Promise(() => {}));
    render(<Painel />);
    expect(screen.getByRole('status')).toHaveTextContent(/Carregando painel/i);
  });

  it('base vazia explica o que cadastrar, sem inventar números', async () => {
    api.getOverview.mockResolvedValue(overviewVazio);
    api.getAlerts.mockResolvedValue(semAlertas);
    render(<Painel />);
    expect(await screen.findByText('Nenhum dado operacional ainda')).toBeInTheDocument();
    expect(screen.getByText(/Cadastre clientes, veículos e locações/)).toBeInTheDocument();
    // Nenhum KPI numérico é exibido nesse estado.
    expect(screen.queryByText('Locações ativas')).toBeNull();
  });

  it('falha da API vira erro visível com "tentar novamente"', async () => {
    api.getOverview.mockRejectedValue(new Error('HTTP 500'));
    render(<Painel />);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/Não foi possível carregar o painel/i);
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('retry refaz a chamada', async () => {
    api.getOverview.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValue(overviewCheio);
    render(<Painel />);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Disponíveis')).toBeInTheDocument();
  });

  it('falha só dos gráficos NÃO derruba o painel', async () => {
    api.getDashboardSeries.mockRejectedValue(new Error('timeout'));
    api.getAlerts.mockRejectedValue(new Error('timeout'));
    render(<Painel />);
    expect(await screen.findByText('Disponíveis')).toBeInTheDocument();
  });
});

describe('período', () => {
  it('trocar o período recarrega os indicadores com o novo intervalo', async () => {
    render(<Painel />);
    await screen.findByText('Disponíveis');
    api.getOverview.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: '7 dias' }));
    expect(api.getOverview).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });
});
