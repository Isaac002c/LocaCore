import { apiRequest } from './api.js';

// ============================================
// AUTOMATIONS API — Ciclo 3 (cobrança semanal, WhatsApp, fiscal, custos).
// ============================================
const BASE = '/api/automations';

export const getAutomationStatus = async () => (await apiRequest(`${BASE}/status`)).data;
export const getSettings = async () => (await apiRequest(`${BASE}/settings`)).data;
export const updateSettings = async (patch) => (await apiRequest(`${BASE}/settings`, { method: 'PUT', body: patch })).data;
export const getRuns = async () => (await apiRequest(`${BASE}/runs`)).data;
export const getReadiness = async ({ mode = '', rental_ids = [] } = {}) => {
  const qs = new URLSearchParams();
  if (mode) qs.set('mode', mode);
  if (rental_ids.length) qs.set('rental_ids', rental_ids.join(','));
  return (await apiRequest(`${BASE}/integrations${qs.toString() ? `?${qs}` : ''}`)).data;
};
export const runDryRun = async (rentalIds = null) => (await apiRequest(`${BASE}/dry-run`, {
  method: 'POST', body: { rental_ids: rentalIds },
})).data;

export const runBilling = async () => (await apiRequest(`${BASE}/run/billing`, { method: 'POST' })).data;
export const runDunning = async () => (await apiRequest(`${BASE}/run/dunning`, { method: 'POST' })).data;
export const runOutbox = async () => (await apiRequest(`${BASE}/run/outbox`, { method: 'POST' })).data;
export const runFiscalBatch = async () => (await apiRequest(`${BASE}/run/fiscal-batch`, { method: 'POST' })).data;

export const getMessages = async ({ status = '', kind = '' } = {}) => {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (kind) qs.set('kind', kind);
  const s = qs.toString();
  return (await apiRequest(`${BASE}/messages${s ? `?${s}` : ''}`)).data;
};
export const retryMessage = async (id) => (await apiRequest(`${BASE}/messages/${id}/retry`, { method: 'POST' })).data;

export const getCharges = async (filters = {}) => {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) qs.set(key, value); });
  const suffix = qs.toString();
  return (await apiRequest(`${BASE}/charges${suffix ? `?${suffix}` : ''}`)).data;
};
export const retryCharge = async (id) => (await apiRequest(`${BASE}/charges/${id}/retry`, { method: 'POST' })).data;
// Confirmação manual do pagamento (§49) — dispara recibo/NFS-e + documento.
export const confirmChargeManually = async (id, body) => (await apiRequest(`${BASE}/charges/${id}/confirm`, { method: 'POST', body })).data;
// Linha do tempo da cobrança (§38), a partir da trilha de auditoria.
export const getChargeTimeline = async (id) => (await apiRequest(`${BASE}/charges/${id}/timeline`)).data;
// Classificação fiscal por natureza da cobrança (§12).
export const getFiscalCategories = async () => (await apiRequest(`${BASE}/fiscal/categories`)).data;
export const saveFiscalCategory = async (key, body) => (await apiRequest(`${BASE}/fiscal/categories/${key}`, { method: 'PUT', body })).data;

export const getIntegrationSecrets = async (kind) => (await apiRequest(`${BASE}/integrations/${kind}/secrets`)).data;
export const saveIntegrationSecrets = async (kind, values) => (await apiRequest(`${BASE}/integrations/${kind}/secrets`, { method: 'PUT', body: values })).data;
export const testIntegration = async (kind) => (await apiRequest(`${BASE}/integrations/${kind}/test`, { method: 'POST' })).data;
export const getFiscalCertificate = async () => (await apiRequest(`${BASE}/fiscal/certificate`)).data;
export const getAutomationAudit = async ({ limit = 100, charge_id = '' } = {}) => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (charge_id) qs.set('charge_id', charge_id);
  return (await apiRequest(`${BASE}/audit?${qs}`)).data;
};

export const uploadFiscalCertificate = async (file, password) => {
  const form = new FormData(); form.append('certificate', file); form.append('password', password);
  const token = typeof window !== 'undefined'
    ? localStorage.getItem('token') || localStorage.getItem('auth-token') || '' : '';
  const response = await fetch(`${BASE}/fiscal/certificate`, {
    method: 'POST', credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data.data;
};

export const getFiscalDocs = async ({ status = '' } = {}) =>
  (await apiRequest(`${BASE}/fiscal${status ? `?status=${status}` : ''}`)).data;
export const retryFiscal = async (id) => (await apiRequest(`${BASE}/fiscal/${id}/retry`, { method: 'POST' })).data;

export const getCosts = async () => (await apiRequest(`${BASE}/costs`)).data;

export const getTemplates = async () => (await apiRequest(`${BASE}/templates`)).data;
export const saveTemplate = async (t) => (await apiRequest(`${BASE}/templates`, { method: 'PUT', body: t })).data;

// ── Console operacional (§8) ────────────────────────────────────────────────
// Uma chamada com worker, scheduler, jobs, fila, dead-letter, retries,
// cobranças, pagamentos conciliados, fiscais e custos.
export const getConsole = async ({ from = '', to = '' } = {}) => {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const s = qs.toString();
  return (await apiRequest(`${BASE}/console${s ? `?${s}` : ''}`)).data;
};

// Mensagens que esgotaram as tentativas (payload já sanitizado pelo backend).
export const getDeadLetter = async ({ limit = 100 } = {}) =>
  (await apiRequest(`${BASE}/dead-letter?limit=${limit}`)).data;

export const cancelDeadLetter = async (id, reason) =>
  (await apiRequest(`${BASE}/dead-letter/${id}/cancel`, { method: 'POST', body: { reason } })).data;

export const manualDeadLetter = async (id, reason) =>
  (await apiRequest(`${BASE}/dead-letter/${id}/manual`, { method: 'POST', body: { reason } })).data;
