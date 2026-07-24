import { apiRequest } from './api.js';

// ============================================
// CONFIG OPTIONS API — listas parametrizáveis por tenant (categorias etc.).
// ============================================
const BASE = '/api/config-options';

export const getOptions = async (kind, { all = false } = {}) =>
  (await apiRequest(`${BASE}?kind=${encodeURIComponent(kind)}${all ? '&all=1' : ''}`)).data;

export const createOption = async (kind, value, sort_order) =>
  (await apiRequest(BASE, { method: 'POST', body: { kind, value, sort_order } })).data;

export const updateOption = async (id, data) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: data })).data;
