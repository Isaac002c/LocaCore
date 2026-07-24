import { apiRequest } from './api.js';

// ============================================
// IMPORT API — Importação CSV (clientes / veiculos).
// ============================================
const BASE = '/api/import';

export const previewImport = async (entity, csv) =>
  (await apiRequest(`${BASE}/${entity}/preview`, { method: 'POST', body: { csv } })).data;

export const commitImport = async (entity, csv) =>
  (await apiRequest(`${BASE}/${entity}/commit`, { method: 'POST', body: { csv } })).data;
