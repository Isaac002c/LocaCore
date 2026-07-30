'use client';

// =============================================================================
// states.jsx — Estados VISÍVEIS padrão de toda tela do LocaCore.
//
// Regra do produto: a área central NUNCA fica vazia. Toda tela tem um destes
// estados: carregando, erro (com retry), vazio (com o que cadastrar primeiro),
// sem permissão, módulo indisponível — ou o conteúdo real.
//
// O ErrorBoundary garante que um erro de RENDER também vire tela visível em vez
// de apagar o conteúdo (que era exatamente o sintoma do Painel em branco).
// =============================================================================

import { Component } from 'react';
import { EmptyState } from './ui';

// Re-exporta para que as telas tenham UM caminho de import para estados.
export { EmptyState };

// ── Loading ──────────────────────────────────────────────────────────────────
export function PageLoading({ label = 'Carregando...', compact = false }) {
  return (
    <div className="nx-state nx-state--loading" role="status" aria-live="polite"
         style={compact ? { padding: '28px 0' } : undefined}>
      <div className="nx-state-spinner" />
      <p>{label}</p>
    </div>
  );
}

// ── Retry ────────────────────────────────────────────────────────────────────
export function RetryButton({ onRetry, label = 'Tentar novamente', busy = false }) {
  if (typeof onRetry !== 'function') return null;
  return (
    <button type="button" className="btn-secondary" onClick={onRetry} disabled={busy}>
      {busy ? 'Tentando...' : label}
    </button>
  );
}

// ── Erro ─────────────────────────────────────────────────────────────────────
// `message` é a mensagem amigável. `detail` é o texto técnico (mensagem do
// erro) — mostrado sob demanda, nunca stack trace nem segredo.
export function PageError({
  title = 'Não foi possível carregar esta tela',
  message,
  detail,
  onRetry,
  compact = false,
}) {
  const friendly = message || 'Ocorreu um erro ao buscar os dados. Verifique sua conexão e tente novamente.';
  return (
    <div className="nx-state nx-state--error" role="alert"
         style={compact ? { padding: '24px 0' } : undefined}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <h4>{title}</h4>
      <p>{friendly}</p>
      {detail && detail !== friendly && (
        <details className="nx-state-detail">
          <summary>Detalhes técnicos</summary>
          <code>{String(detail)}</code>
        </details>
      )}
      <div className="nx-state-actions"><RetryButton onRetry={onRetry} /></div>
    </div>
  );
}

// ── Banner de erro em linha (para erros de AÇÃO, não de carregamento) ────────
export function InlineError({ message, onDismiss, onRetry }) {
  if (!message) return null;
  return (
    <div className="nx-inline-error" role="alert">
      <span className="nx-inline-error-msg">{message}</span>
      <span className="nx-inline-error-actions">
        {typeof onRetry === 'function' && (
          <button type="button" className="nx-inline-error-btn" onClick={onRetry}>Tentar novamente</button>
        )}
        {typeof onDismiss === 'function' && (
          <button type="button" className="btn-close" onClick={onDismiss} aria-label="Fechar aviso">✕</button>
        )}
      </span>
    </div>
  );
}

// ── Permissão ────────────────────────────────────────────────────────────────
export function PermissionDenied({
  what = 'esta tela',
  role,
  message,
}) {
  return (
    <div className="nx-state nx-state--denied" role="alert">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <h4>Acesso restrito</h4>
      <p>{message || `Seu perfil${role ? ` (${role})` : ''} não tem permissão para acessar ${what}. Peça a um administrador da empresa para liberar o acesso.`}</p>
    </div>
  );
}

// ── Módulo não habilitado para o tenant ──────────────────────────────────────
export function ModuleUnavailable({ moduleLabel = 'Este módulo' }) {
  return (
    <div className="nx-state nx-state--denied" role="alert">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
      </svg>
      <h4>Módulo não habilitado</h4>
      <p>{moduleLabel} não está habilitado para a sua empresa. Fale com o suporte para contratar ou ativar este módulo.</p>
    </div>
  );
}

// ── Tela inexistente (rota/tab desconhecida) ─────────────────────────────────
export function ScreenNotFound({ tab, moduleKey, onGoHome, homeLabel = 'Ir para o início' }) {
  return (
    <div className="nx-state nx-state--empty">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <h4>Tela não encontrada</h4>
      <p>
        A tela <code>{tab || '(sem tab)'}</code> não existe no módulo <code>{moduleKey}</code>.
        O link pode estar desatualizado. Use o menu lateral para navegar.
      </p>
      {typeof onGoHome === 'function' && (
        <div className="nx-state-actions">
          <button type="button" className="btn-primary" onClick={onGoHome}>{homeLabel}</button>
        </div>
      )}
    </div>
  );
}

// ── ErrorBoundary ────────────────────────────────────────────────────────────
// Impede que um erro de render de UMA tela apague a área de conteúdo inteira.
// Registra o erro técnico no console (para suporte) e mostra mensagem clara.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log técnico — não vai para a tela.
    console.error(`[LocaCore] Falha ao renderizar "${this.props.label || 'tela'}":`, error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Trocar de tela limpa o erro anterior.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <PageError
          title="Esta tela apresentou um erro"
          message={`Não foi possível exibir ${this.props.label ? `"${this.props.label}"` : 'esta tela'}. A equipe consegue ver o detalhe técnico no log do navegador.`}
          detail={this.state.error?.message}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

const States = { PageLoading, PageError, EmptyState, ErrorBoundary, RetryButton, PermissionDenied, ModuleUnavailable, ScreenNotFound, InlineError };
export default States;
