// =============================================================================
// Estados de tela — a garantia de que a área central NUNCA fica vazia.
//
// Foi exatamente a ausência disso que produziu o Painel em branco: o roteador
// não achava a tela e simplesmente não renderizava nada.
// =============================================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  PageLoading, PageError, EmptyState, ErrorBoundary, RetryButton,
  PermissionDenied, ModuleUnavailable, ScreenNotFound, InlineError,
} from '../app/components/states';

describe('PageLoading', () => {
  it('anuncia o carregamento para leitores de tela', () => {
    render(<PageLoading label="Carregando painel..." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Carregando painel...');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});

describe('PageError', () => {
  it('mostra mensagem amigável e permite tentar novamente', async () => {
    const onRetry = vi.fn();
    render(<PageError message="Falha ao buscar os dados." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao buscar os dados.');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('esconde o detalhe técnico atrás de "detalhes"', () => {
    render(<PageError message="Erro amigável" detail="TypeError: x is not a function" />);
    expect(screen.getByText(/detalhes técnicos/i)).toBeInTheDocument();
    expect(screen.getByText(/TypeError/)).toBeInTheDocument();
  });

  it('sem onRetry, não mostra botão quebrado', () => {
    render(<PageError message="Erro" />);
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
  });

  it('não repete o detalhe quando ele é igual à mensagem', () => {
    render(<PageError message="Igual" detail="Igual" />);
    expect(screen.queryByText(/detalhes técnicos/i)).toBeNull();
  });
});

describe('RetryButton', () => {
  it('não renderiza nada sem handler', () => {
    const { container } = render(<RetryButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('fica desabilitado enquanto tenta', () => {
    render(<RetryButton onRetry={() => {}} busy />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('EmptyState', () => {
  it('explica o que fazer e oferece a ação', async () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="Nenhum dado operacional ainda"
        description="Cadastre clientes, veículos e locações."
        actionLabel="Cadastrar primeiro veículo"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Nenhum dado operacional ainda')).toBeInTheDocument();
    expect(screen.getByText(/Cadastre clientes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cadastrar primeiro veículo/i }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('sem ação, não mostra botão', () => {
    render(<EmptyState title="Vazio" description="Nada aqui." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ScreenNotFound', () => {
  it('diz qual tela e qual módulo falharam', async () => {
    const onGoHome = vi.fn();
    render(<ScreenNotFound tab="importacao" moduleKey="locacao" onGoHome={onGoHome} />);
    expect(screen.getByText('Tela não encontrada')).toBeInTheDocument();
    expect(screen.getByText('importacao')).toBeInTheDocument();
    expect(screen.getByText('locacao')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /ir para o início/i }));
    expect(onGoHome).toHaveBeenCalledOnce();
  });
});

describe('PermissionDenied', () => {
  it('explica o bloqueio sem culpar o usuário', () => {
    render(<PermissionDenied what='"Automações"' role="operator" />);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Acesso restrito');
    expect(alerta).toHaveTextContent('operator');
    expect(alerta).toHaveTextContent(/administrador da empresa/i);
  });
});

describe('ModuleUnavailable', () => {
  it('diz que o módulo não está habilitado para a empresa', () => {
    render(<ModuleUnavailable moduleLabel="O módulo Processos" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Módulo não habilitado');
    expect(screen.getByRole('alert')).toHaveTextContent('O módulo Processos');
  });
});

describe('InlineError', () => {
  it('não ocupa espaço quando não há erro', () => {
    const { container } = render(<InlineError message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('permite tentar de novo e dispensar', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(<InlineError message="Falhou" onRetry={onRetry} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    await userEvent.click(screen.getByRole('button', { name: /fechar aviso/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('ErrorBoundary', () => {
  const Explode = () => { throw new Error('boom interno'); };

  it('mostra erro visível em vez de apagar o conteúdo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary label="Frota">
        <Explode />
      </ErrorBoundary>,
    );
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Esta tela apresentou um erro');
    expect(alerta).toHaveTextContent('Frota');
    // O detalhe técnico fica disponível, mas não é a mensagem principal.
    expect(screen.getByText('boom interno')).toBeInTheDocument();
  });

  it('renderiza o conteúdo normalmente quando não há erro', () => {
    render(
      <ErrorBoundary label="Frota">
        <p>conteúdo real</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('conteúdo real')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('registra o erro técnico no console para o suporte', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary label="Frota"><Explode /></ErrorBoundary>);
    expect(spy).toHaveBeenCalled();
    const registrou = spy.mock.calls.some((c) => String(c[0]).includes('[LocaCore]'));
    expect(registrou).toBe(true);
  });
});
