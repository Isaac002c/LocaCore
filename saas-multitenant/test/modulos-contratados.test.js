// =============================================================================
// ÁREAS CONTRATADAS — telas compartilhadas e o caminho de volta.
//
// Regressão real reportada em produção: no tenant Rental Log (que só contratou
// Locação e Financeiro) o usuário criava um cliente, entrava no detalhe e ao
// voltar batia em "O módulo Processos não está habilitado para a sua empresa".
//
// Causa: a tela de detalhe do cliente mora fora do shell, nasceu no módulo
// despachante e voltava com `?module=multas` FIXO no código.
// =============================================================================
import { describe, it, expect } from 'vitest';
import {
  enabledModulesOf, isModuleEnabled, getHomeModule, resolveModuleForTab, tabExists,
} from '../app/lib/navigation';

// Rental Log: só Locação e Financeiro.
const RENTAL_LOG = { name: 'Rental Log', slug: 'rental-log', modules: ['locacao', 'financeiro'] };
// Tenant antigo, sem `modules` — todas as áreas valem.
const LEGADO = { name: 'Antigo', slug: 'antigo' };
// Despachante puro.
const DESPACHANTE = { name: 'Despachante', slug: 'desp', modules: ['multas', 'financeiro'] };

describe('áreas contratadas', () => {
  it('lê tenant.modules e trata ausência como "todas"', () => {
    expect(enabledModulesOf(RENTAL_LOG)).toEqual(['locacao', 'financeiro']);
    expect(enabledModulesOf(LEGADO)).toBeNull();
    expect(enabledModulesOf({ modules: [] })).toBeNull();
  });

  it('bloqueia área não contratada e libera as contratadas', () => {
    expect(isModuleEnabled('locacao', RENTAL_LOG)).toBe(true);
    expect(isModuleEnabled('financeiro', RENTAL_LOG)).toBe(true);
    expect(isModuleEnabled('multas', RENTAL_LOG)).toBe(false);
  });

  it('tenant sem modules continua com tudo liberado', () => {
    for (const m of ['locacao', 'multas', 'financeiro']) {
      expect(isModuleEnabled(m, LEGADO)).toBe(true);
    }
  });

  it('Configurações é interna: nunca bloqueada', () => {
    expect(isModuleEnabled('settings', RENTAL_LOG)).toBe(true);
    expect(isModuleEnabled('settings', DESPACHANTE)).toBe(true);
  });
});

describe('início do tenant', () => {
  it('é a primeira área CONTRATADA que a role enxerga', () => {
    expect(getHomeModule(RENTAL_LOG, 'admin')).toBe('locacao');
    expect(getHomeModule(DESPACHANTE, 'admin')).toBe('multas');
  });

  it('nunca devolve uma área não contratada', () => {
    for (const role of ['admin', 'manager', 'operator', 'seller', 'viewer']) {
      const home = getHomeModule(RENTAL_LOG, role);
      expect(isModuleEnabled(home, RENTAL_LOG), `role=${role} caiu em ${home}`).toBe(true);
    }
  });

  it('consultor não cai no Financeiro (área restrita a admin)', () => {
    expect(getHomeModule(RENTAL_LOG, 'seller')).toBe('locacao');
  });
});

describe('telas compartilhadas voltam para a área certa', () => {
  it('REGRESSÃO: cliente na Rental Log volta para Locação, não para Processos', () => {
    // Era exatamente isto que quebrava: `preferred` vinha 'multas' fixo.
    expect(resolveModuleForTab('clients', { preferred: 'multas', tenant: RENTAL_LOG, role: 'admin' }))
      .toBe('locacao');
  });

  it('no despachante, cliente continua voltando para Processos', () => {
    expect(resolveModuleForTab('clients', { preferred: 'multas', tenant: DESPACHANTE, role: 'admin' }))
      .toBe('multas');
  });

  it('respeita a origem quando ela é válida e contratada', () => {
    expect(resolveModuleForTab('clients', { preferred: 'locacao', tenant: RENTAL_LOG, role: 'admin' }))
      .toBe('locacao');
  });

  it('ignora origem inexistente e usa uma área contratada', () => {
    const destino = resolveModuleForTab('clients', { preferred: 'inventado', tenant: RENTAL_LOG, role: 'admin' });
    expect(isModuleEnabled(destino, RENTAL_LOG)).toBe(true);
    expect(tabExists(destino, 'clients')).toBe(true);
  });

  it('tela que SÓ existe no despachante não força área não contratada', () => {
    // `companies` só existe em multas. Num tenant sem multas, o retorno precisa
    // ser uma área que ele tenha — melhor cair no início que travar o usuário.
    const destino = resolveModuleForTab('companies', { preferred: 'multas', tenant: RENTAL_LOG, role: 'admin' });
    expect(isModuleEnabled(destino, RENTAL_LOG), `caiu em ${destino}`).toBe(true);
  });

  it('o destino sempre existe e é navegável', () => {
    const tenants = [RENTAL_LOG, DESPACHANTE, LEGADO];
    for (const tenant of tenants) {
      for (const tab of ['clients', 'companies']) {
        const destino = resolveModuleForTab(tab, { preferred: 'multas', tenant, role: 'admin' });
        expect(isModuleEnabled(destino, tenant), `${tenant.slug}/${tab} → ${destino}`).toBe(true);
      }
    }
  });
});
