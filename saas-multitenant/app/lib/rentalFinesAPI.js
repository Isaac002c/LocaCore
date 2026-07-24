import { apiRequest } from './api.js';

// MULTAS DA LOCADORA (LocaCore).
const BASE = '/api/rental-fines';
const qs = (p = {}) => { const s = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v) s.set(k, v); }); const t = s.toString(); return t ? `?${t}` : ''; };

export const getFines = async (p = {}) => (await apiRequest(`${BASE}${qs(p)}`)).data;
export const getFineStats = async () => (await apiRequest(`${BASE}/stats`)).data;
export const createFine = async (d) => (await apiRequest(BASE, { method: 'POST', body: d })).data;
export const updateFine = async (id, d) => (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: d })).data;
export const setFineStatus = async (id, status) => (await apiRequest(`${BASE}/${id}/status`, { method: 'PATCH', body: { status } })).data;
export const faturarFine = async (id) => (await apiRequest(`${BASE}/${id}/faturar`, { method: 'POST' })).data;
export const fineToExtra = async (id) => (await apiRequest(`${BASE}/${id}/adicional`, { method: 'POST' })).data;
export const deleteFine = async (id) => (await apiRequest(`${BASE}/${id}`, { method: 'DELETE' })).data;
