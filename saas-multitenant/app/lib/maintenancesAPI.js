import { apiRequest } from './api.js';

// ============================================
// MAINTENANCES API — Manutenções da frota (LocaCore).
// ============================================
const BASE = '/api/maintenances';

export const getMaintenances = async ({ status = '', vehicle_id = '' } = {}) => {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (vehicle_id) qs.set('vehicle_id', vehicle_id);
  const s = qs.toString();
  return (await apiRequest(`${BASE}${s ? `?${s}` : ''}`)).data;
};
export const getUpcomingMaintenances = async () => (await apiRequest(`${BASE}/upcoming`)).data;
export const createMaintenance = async (data) => (await apiRequest(BASE, { method: 'POST', body: data })).data;
export const updateMaintenance = async (id, data) => (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: data })).data;
export const setMaintenanceStatus = async (id, status) => (await apiRequest(`${BASE}/${id}/status`, { method: 'PATCH', body: { status } })).data;
export const deleteMaintenance = async (id) => (await apiRequest(`${BASE}/${id}`, { method: 'DELETE' })).data;
