import { apiRequest } from './api.js';

// ============================================
// RENTALS API — Locações (LocaCore). Chamadas passam pelo proxy /api → backend.
// ============================================
const BASE = '/api/rentals';

const buildQuery = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const getRentals = async ({ status = '', client_id = '', vehicle_id = '', q = '' } = {}) =>
  (await apiRequest(`${BASE}${buildQuery({ status, client_id, vehicle_id, q })}`)).data;

export const getRentalStats = async () =>
  (await apiRequest(`${BASE}/stats`)).data;

export const getRentalById = async (id) =>
  (await apiRequest(`${BASE}/${id}`)).data;

export const getRentalBillings = async (id) =>
  (await apiRequest(`${BASE}/${id}/billings`)).data;

export const createRental = async (data) =>
  (await apiRequest(BASE, { method: 'POST', body: data })).data;

export const updateRental = async (id, data) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: data })).data;

export const setRentalStatus = async (id, status) =>
  (await apiRequest(`${BASE}/${id}/status`, { method: 'PATCH', body: { status } })).data;

export const returnRental = async (id, data = {}) =>
  (await apiRequest(`${BASE}/${id}/return`, { method: 'POST', body: data })).data;

export const cancelRental = async (id, reason) =>
  (await apiRequest(`${BASE}/${id}/cancel`, { method: 'POST', body: { reason } })).data;

export const faturarRental = async (id, data = {}) =>
  (await apiRequest(`${BASE}/${id}/faturar`, { method: 'POST', body: data })).data;

export const generateReceipt = async (id, data = {}) => {
  const res = await apiRequest(`${BASE}/${id}/recibo`, { method: 'POST', body: data });
  return { receipt: res.data, existing: !!res.existing };
};

export const getRentalPayments = async (id) =>
  (await apiRequest(`${BASE}/${id}/payments`)).data;

export const deleteRental = async (id) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'DELETE' })).data;

// ── Contrato (§7) ────────────────────────────────────────────────────────────
export const generateContract = async (id) =>
  (await apiRequest(`${BASE}/${id}/contract`, { method: 'POST' })).data;
export const contractPdfUrl = (id) => `${BASE}/${id}/contract.pdf`;

// ── Adicionais (extras) ──────────────────────────────────────────────────────
export const getRentalExtras = async (id) =>
  (await apiRequest(`${BASE}/${id}/extras`)).data;

export const addRentalExtra = async (id, data) =>
  (await apiRequest(`${BASE}/${id}/extras`, { method: 'POST', body: data })).data;

export const deleteRentalExtra = async (id, extraId) =>
  (await apiRequest(`${BASE}/${id}/extras/${extraId}`, { method: 'DELETE' })).data;

// ── Documentos ───────────────────────────────────────────────────────────────
export const getRentalDocuments = async (id) =>
  (await apiRequest(`${BASE}/${id}/documents`)).data;

export const addRentalDocument = async (id, data) =>
  (await apiRequest(`${BASE}/${id}/documents`, { method: 'POST', body: data })).data;

export const deleteRentalDocument = async (id, docId) =>
  (await apiRequest(`${BASE}/${id}/documents/${docId}`, { method: 'DELETE' })).data;
