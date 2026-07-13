import { apiRequest } from './api.js';

// ============================================
// PLANS API
// ============================================

// Listar todos os planos disponíveis
export const getPlans = async () =>
  (await apiRequest('/api/plans')).data;

// ============================================
// SUBSCRIPTION API
// ============================================

// Buscar assinatura atual
export const getSubscription = async () =>
  (await apiRequest('/api/subscription')).data;

// Verificar limites do plano
export const checkPlanLimits = async (resource, count) =>
  (await apiRequest(`/api/subscription/limits/${resource}?count=${count}`)).data;

// ============================================
// ACTIVITY LOGS API
// ============================================

// Listar logs de atividades com filtros
export const getActivityLogs = async (filters = {}) => {
  const params = new URLSearchParams({
    page: filters.page || 1,
    limit: filters.limit || 50,
    ...(filters.entity_type && { entity_type: filters.entity_type }),
    ...(filters.action && { action: filters.action }),
    ...(filters.days && { days: filters.days }),
  });
  return (await apiRequest(`/api/activity?${params}`)).data;
};

// Estatísticas de atividades
export const getActivityStats = async (days = 30) =>
  (await apiRequest(`/api/activity/stats?days=${days}`)).data;

// Logs de uma entidade específica
export const getEntityActivity = async (entityType, entityId) =>
  (await apiRequest(`/api/activity/entity/${entityType}/${entityId}`)).data;

// ============================================
// ADMIN API - Empresas (apenas admin)
// ============================================

// Listar todas as empresas
export const getTenants = async (page = 1, limit = 20) =>
  (await apiRequest(`/api/admin/tenants?page=${page}&limit=${limit}`)).data;

// Detalhes de uma empresa
export const getTenantDetails = async (id) =>
  (await apiRequest(`/api/admin/tenants/${id}`)).data;

// Criar nova empresa
export const createTenant = async (tenantData) =>
  (await apiRequest('/api/admin/tenants', {
    method: 'POST',
    body: tenantData,
  })).data;

// Atualizar status da empresa
export const updateTenantStatus = async (id, isActive) =>
  (await apiRequest(`/api/admin/tenants/${id}/status`, {
    method: 'PATCH',
    body: { is_active: isActive },
  })).data;
