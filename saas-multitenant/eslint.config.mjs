import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      // Regras do React Compiler adicionadas pelo preset atual. O projeto ainda
      // usa padrões válidos do React 18; mantê-las desligadas preserva o nível de
      // lint anterior à atualização do Next, sem mascarar erros de compilação.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/refs': 'off',
      '@next/next/no-img-element': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'backend/**',
    'node_modules/**',
  ]),
]);
