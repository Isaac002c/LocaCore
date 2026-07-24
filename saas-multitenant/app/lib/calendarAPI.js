import { apiRequest } from './api.js';

const BASE = '/api/calendar-events';

export const getEvents = async (scope = 'upcoming') =>
  (await apiRequest(`${BASE}?scope=${scope}`)).data;

export const getEventsRange = async (from, to) =>
  (await apiRequest(`${BASE}?from=${from}&to=${to}`)).data;

// Agenda operacional da LOCADORA: eventos manuais + derivados (locações/manutenções/multas).
export const getAgenda = async ({ from = '', to = '', type = '' } = {}) => {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (type) qs.set('type', type);
  const s = qs.toString();
  return (await apiRequest(`${BASE}/agenda${s ? `?${s}` : ''}`)).data;
};

export const getUpcomingEvents = async (limit = 5) =>
  (await apiRequest(`${BASE}/upcoming?limit=${limit}`)).data;

// Usuários ativos do tenant para o select "Consultor" ([{ id, name }])
export const getConsultants = async () =>
  (await apiRequest(`${BASE}/consultants`)).data;

export const createEvent = async (data) =>
  (await apiRequest(BASE, { method: 'POST', body: data })).data;

export const updateEvent = async (id, data) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'PUT', body: data })).data;

export const setEventStatus = async (id, status) =>
  (await apiRequest(`${BASE}/${id}/status`, { method: 'PATCH', body: { status } })).data;

export const deleteEvent = async (id) =>
  (await apiRequest(`${BASE}/${id}`, { method: 'DELETE' })).data;
