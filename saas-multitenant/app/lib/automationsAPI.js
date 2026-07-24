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
