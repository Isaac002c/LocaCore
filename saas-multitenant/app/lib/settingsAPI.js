import { apiRequest } from './api.js';

// =============================================================================
// SETTINGS API — Central de Configurações (§7).
//
// Não cria endpoint novo: apenas agrupa os que já existem, para a central ter
// UM caminho de import. Cada aba continua gravando na sua fonte de verdade
// original (nada é duplicado).
// =============================================================================

// ── Empresa / Financeiro (tenant_financial_settings) ────────────────────────
export const getCompanySettings = async () => (await apiRequest('/api/financial/settings')).data;
export const saveCompanySettings = async (data) =>
  (await apiRequest('/api/financial/settings', { method: 'PUT', body: data })).data;

// ── Contratos (tenant_contract_settings) ────────────────────────────────────
export const getContractSettings = async () => (await apiRequest('/api/rentals/contract-settings')).data;
export const saveContractSettings = async (data) =>
  (await apiRequest('/api/rentals/contract-settings', { method: 'PUT', body: data })).data;

// ── Perfis e permissões (somente leitura: a matriz vem do backend) ──────────
export const getRoles = async () => (await apiRequest('/api/users/management/roles')).data;

// ── Automações ──────────────────────────────────────────────────────────────
export const getAutomationSettings = async () => (await apiRequest('/api/automations/settings')).data;
export const saveAutomationSettings = async (data) =>
  (await apiRequest('/api/automations/settings', { method: 'PUT', body: data })).data;

// ── Prontidão das integrações (§13) ─────────────────────────────────────────
export const getIntegrationsReadiness = async () => (await apiRequest('/api/automations/integrations')).data;
