import { apiRequest } from './api.js';

// ============================================
// AUTOMATIONS API — Ciclo 3 (cobrança semanal, WhatsApp, fiscal, custos).
// ============================================
const BASE = '/api/automations';

export const getAutomationStatus = async () => (await apiRequest(`${BASE}/status`)).data;
export const getSettings = async () => (await apiRequest(`${BASE}/settings`)).data;
export const updateSettings = async (patch) => (await apiRequest(`${BASE}/settings`, { method: 'PUT', body: patch })).data;
export const getRuns = async () => (await apiRequest(`${BASE}/runs`)).data;

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
