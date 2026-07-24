import { apiRequest } from './api.js';

// ============================================
// REPORTS API — Dashboard/Relatórios (LocaCore).
// ============================================
const BASE = '/api/reports';

const qs = (params = {}) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) s.set(k, v); });
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const getOverview = async () => (await apiRequest(`${BASE}/overview`)).data;

export const getRevenue = async ({ from = '', to = '' } = {}) =>
  (await apiRequest(`${BASE}/revenue${qs({ from, to })}`)).data;

export const getRentalsReport = async ({ from = '', to = '', status = '' } = {}) =>
  (await apiRequest(`${BASE}/rentals${qs({ from, to, status })}`)).data;

export const getFleetUtilization = async () => (await apiRequest(`${BASE}/fleet`)).data;

// URLs de exportação CSV (abertas em nova aba; passam pelo proxy /api).
export const revenueCsvUrl = ({ from = '', to = '' } = {}) => `${BASE}/revenue${qs({ from, to, format: 'csv' })}`;
export const rentalsCsvUrl = ({ from = '', to = '', status = '' } = {}) => `${BASE}/rentals${qs({ from, to, status, format: 'csv' })}`;
