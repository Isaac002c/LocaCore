'use client';

// =============================================================================
// voltar.js — Para onde uma TELA DE DETALHE volta.
//
// Telas como `clients/[id]`, `companies/[id]` e `vehicles/[vid]` vivem em rotas
// próprias, FORA do shell. Elas nasceram no módulo despachante e voltavam com
// `?module=multas` fixo no código.
//
// Num tenant que só contratou Locação (Rental Log), esse link levava para uma
// área não contratada: o usuário criava um cliente, entrava nele e ao voltar
// batia em "O módulo Processos não está habilitado para a sua empresa".
//
// Aqui a área de retorno é RESOLVIDA: respeita a origem quando ela é válida,
// e cai na primeira área contratada que tenha aquela tela.
// =============================================================================

import { resolveModuleForTab, getHomeModule, getDefaultTab } from './navigation';

// O tenant/usuário logado ficam em localStorage (mesma fonte do shell).
const lerJson = (chave) => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(chave) || 'null'); }
  catch { return null; }
};

export const tenantAtual = () => lerJson('tenant');
export const usuarioAtual = () => lerJson('user');

/** Gera a URL da ficha de cliente preservando a página de origem atual. */
export function urlDetalheCliente(clientId) {
  const returnTo = typeof window === 'undefined'
    ? urlDeVolta('clients')
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({ returnTo });
  return `/multas/clients/${encodeURIComponent(clientId)}?${params.toString()}`;
}

/** Aceita somente destinos internos do próprio aplicativo. */
export function urlRetornoInterno(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const origin = 'https://locacore.invalid';
    const target = new URL(value, origin);
    if (target.origin !== origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

/**
 * URL do dashboard para uma tela compartilhada, na área correta do tenant.
 * @param {string} tab       tela de destino (ex.: 'clients')
 * @param {string} [origem]  área de onde o usuário veio (query `?from=`)
 */
export function urlDeVolta(tab, origem) {
  const tenant = tenantAtual();
  const role = usuarioAtual()?.role || 'seller';
  const modulo = resolveModuleForTab(tab, { preferred: origem, tenant, role });
  return `/dashboard?module=${modulo}&tab=${tab}`;
}

/** URL do "início" do tenant — a primeira área contratada que a role enxerga. */
export function urlInicio() {
  const tenant = tenantAtual();
  const role = usuarioAtual()?.role || 'seller';
  const modulo = getHomeModule(tenant, role);
  return `/dashboard?module=${modulo}&tab=${getDefaultTab(modulo, role)}`;
}

/** Lê `?from=` da URL atual (a área de origem, quando informada). */
export function origemDaUrl() {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('from');
  return v || null;
}
