import { apiRequest } from './api.js';

// ✅ ROTAS CORRETAS - User Management

export const getUsers = async () =>
  await apiRequest('/api/users/management');

export const getUsersStats = async () =>
  await apiRequest('/api/users/management/stats');

export const getRoles = async () =>
  await apiRequest('/api/users/management/roles');

export const getUserById = async (id) =>
  await apiRequest(`/api/users/management/${id}`);

export const createUser = async (userData) =>
  await apiRequest('/api/users/management', {
    method: 'POST',
    body: userData,
  });

export const updateUser = async (id, userData) =>
  await apiRequest(`/api/users/management/${id}`, {
    method: 'PUT',
    body: userData,
  });

export const changePassword = async (id, password) =>
  await apiRequest(`/api/users/management/${id}/password`, {
    method: 'PATCH',
    body: { password },
  });

// Ativa/desativa usuário; desativar invalida as sessões existentes.
export const setUserActive = async (id, is_active) =>
  await apiRequest(`/api/users/management/${id}/active`, {
    method: 'PATCH',
    body: { is_active },
  });

export const deleteUser = async (id) =>
  await apiRequest(`/api/users/management/${id}`, {
    method: 'DELETE',
  });
