import { apiRequest } from './api.js';

// ============================================
// VEHICLES API — Frota (LocaCore). Chamadas passam pelo proxy /api → backend.
// ============================================
const BASE = '/api/vehicles';

const buildQuery = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export const getVehicles = async ({ status = '', q = '' } = {}) =>
  (await apiRequest(`${BASE}${buildQuery({ status, q })}`)).data;

export const getAvailableVehicles = async () =>
  (await apiRequest(`${BASE}/available`)).data;

export const getFleetStats = async () =>
  (await apiRequest(`${BASE}/stats`)).data;

export const getVehicleById = async (id) =>
  (await apiRequest(`${BASE}/${id}`)).data;

export const getVehicleRentals = async (id) =>
  (await apiRequest(`${BASE}/${id}/rentals`)).data;

export const createVehicle = async (data) =>
  (await apiRequest(BASE, { method: 'POST', body: data })).data;

export const updateVehicle = async (id, data) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: data })).data;

export const setVehicleStatus = async (id, status) =>
  (await apiRequest(`${BASE}/${id}/status`, { method: 'PATCH', body: { status } })).data;

export const deleteVehicle = async (id) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'DELETE' })).data;
