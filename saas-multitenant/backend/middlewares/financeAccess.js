// =============================================================================
// financeAccess.js — Controle de acesso do módulo Financeiro (no BACKEND).
//
// Regras (MVP):
//   * Administrador (role 'admin'): acesso completo (ler + gerenciar).
//   * Consultor / seller / demais roles: SEM acesso por padrão → 403.
//   * Super Admin (Chronostek): NÃO acessa dados financeiros internos do tenant.
//
// Segurança não depende de ocultar menu: toda rota financeira usa estes guards.
// O tenant vem SEMPRE do token (req.tenantId); tenant_id do payload é ignorado.
// =============================================================================

function deny(res, msg) {
  return res.status(403).json({ success: false, error: msg || 'Acesso negado ao módulo financeiro' });
}

// Leitura do módulo financeiro (admin apenas, no MVP).
function requireFinanceRead(req, res, next) {
  const role = req.userRole || 'seller';
  if (role === 'admin') return next();
  return deny(res, 'Você não tem permissão para acessar o financeiro');
}

// Escrita/gestão (lançamentos, faturamentos, pagamentos, recibos, config).
function requireFinanceManage(req, res, next) {
  const role = req.userRole || 'seller';
  if (role === 'admin') return next();
  return deny(res, 'Você não tem permissão para gerenciar o financeiro');
}

module.exports = { requireFinanceRead, requireFinanceManage };
