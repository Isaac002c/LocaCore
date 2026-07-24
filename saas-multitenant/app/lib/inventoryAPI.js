import { apiRequest } from './api.js';

// ESTOQUE (LocaCore).
const BASE = '/api/inventory';
const qs = (p = {}) => { const s = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v) s.set(k, v); }); const t = s.toString(); return t ? `?${t}` : ''; };

export const getItems = async (p = {}) => (await apiRequest(`${BASE}/items${qs(p)}`)).data;
export const getInventoryDashboard = async () => (await apiRequest(`${BASE}/dashboard`)).data;
export const createItem = async (d) => (await apiRequest(`${BASE}/items`, { method: 'POST', body: d })).data;
export const updateItem = async (id, d) => (await apiRequest(`${BASE}/items/${id}`, { method: 'PUT', body: d })).data;
export const deleteItem = async (id) => (await apiRequest(`${BASE}/items/${id}`, { method: 'DELETE' })).data;
export const getItemMovements = async (id, p = {}) => (await apiRequest(`${BASE}/items/${id}/movements${qs(p)}`)).data;
export const createMovement = async (d) => (await apiRequest(`${BASE}/movements`, { method: 'POST', body: d })).data;
export const exportItemsUrl = () => `${BASE}/export`;
