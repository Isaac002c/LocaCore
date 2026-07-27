'use client';

import { useEffect, useState, useCallback } from 'react';

// =============================================================================
// ThemeToggle (§7) — alterna escuro / claro / sistema.
//
// Prioridade de leitura: 1) preferência salva  2) preferência do SO  3) escuro.
// A escolha persiste em localStorage e é aplicada em <html data-theme>.
// O flash inicial é evitado pelo script inline em app/layout.jsx.
// =============================================================================

export const THEME_KEY = 'locacore-theme';
const MODOS = ['dark', 'light', 'system'];

export const resolverTema = (modo) => {
  if (modo === 'system' || !modo) {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return modo === 'light' ? 'light' : 'dark';
};

export const aplicarTema = (modo) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolverTema(modo));
};

const ICONES = {
  dark: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  light: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  system: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
};
const ROTULOS = { dark: 'Tema escuro', light: 'Tema claro', system: 'Tema do sistema' };

export default function ThemeToggle() {
  const [modo, setModo] = useState('dark');

  useEffect(() => {
    const salvo = localStorage.getItem(THEME_KEY);
    setModo(MODOS.includes(salvo) ? salvo : 'dark');
  }, []);

  // Com "system", acompanha a mudança do SO em tempo real.
  useEffect(() => {
    if (modo !== 'system' || typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => aplicarTema('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [modo]);

  const alternar = useCallback(() => {
    const proximo = MODOS[(MODOS.indexOf(modo) + 1) % MODOS.length];
    setModo(proximo);
    localStorage.setItem(THEME_KEY, proximo);
    aplicarTema(proximo);
  }, [modo]);

  return (
    <button
      type="button"
      onClick={alternar}
      className="tl-icon-btn"
      title={`${ROTULOS[modo]} — clique para alternar`}
      aria-label={`${ROTULOS[modo]}. Clique para alternar o tema.`}
    >
      {ICONES[modo]}
    </button>
  );
}
