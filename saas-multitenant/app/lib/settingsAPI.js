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

const authToken = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('token') || localStorage.getItem('auth-token') ||
    document.cookie.split(';').reduce((found, item) => {
      const [key, value] = item.trim().split('=');
      return found || (/^(token|auth-token)$/.test(key) ? value : '');
    }, '');
};

const contractTemplateUrl = (suffix = '') => {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || '';
  return `${base}/api/rentals/contract-settings/docx-template${suffix}`;
};

export const uploadContractDocxTemplate = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const token = authToken();
  const response = await fetch(contractTemplateUrl(), {
    method: 'POST', credentials: 'include', body: form,
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.data;
};

export const downloadContractDocxTemplate = async () => {
  const token = authToken();
  const response = await fetch(contractTemplateUrl('/download'), {
    credentials: 'include', headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'modelo-contrato.docx';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
};

// ── Perfis e permissões (somente leitura: a matriz vem do backend) ──────────
export const getRoles = async () => (await apiRequest('/api/users/management/roles')).data;

// ── Automações ──────────────────────────────────────────────────────────────
export const getAutomationSettings = async () => (await apiRequest('/api/automations/settings')).data;
export const saveAutomationSettings = async (data) =>
  (await apiRequest('/api/automations/settings', { method: 'PUT', body: data })).data;

// ── Prontidão das integrações (§13) ─────────────────────────────────────────
export const getIntegrationsReadiness = async () => (await apiRequest('/api/automations/integrations')).data;
