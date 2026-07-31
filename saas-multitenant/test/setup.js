// Setup dos testes de frontend: matchers do jest-dom + limpeza entre testes.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// jsdom não implementa matchMedia — o ThemeToggle consulta a preferência do SO.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}

// Silencia o aviso de act() de efeitos assíncronos já cobertos por findBy*.
const erroOriginal = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
  erroOriginal(...args);
};
