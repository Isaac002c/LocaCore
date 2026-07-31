import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// =============================================================================
// Testes de FRONTEND (§12). O backend já tinha suíte; a UI dependia só de
// inspeção de código e smoke manual — inclusive a regressão que deixou o Painel
// em branco passou despercebida por isso.
//
// jsdom + Testing Library: os testes exercitam o COMPORTAMENTO visível
// (o que o usuário vê e clica), não detalhes de implementação.
// =============================================================================
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
  },
});
