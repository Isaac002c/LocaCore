// =============================================================================
// requireModule.js — Gating de MÓDULO por tenant no BACKEND (§12/§15).
//
// Impede que um usuário de um tenant sem o módulo habilitado acesse os endpoints
// apenas digitando a URL. tenant.modules NULL/vazio = todas as áreas habilitadas
// (compatível com os tenants atuais). Tolerante à ausência da coluna (pré-migração).
//
// O tenant vem SEMPRE do token (req.tenantId).
// =============================================================================

const tenantModel = require('../models/tenantModels');

function requireModule(moduleKey) {
  return async (req, res, next) => {
    try {
      const mods = await tenantModel.getTenantModules(req.tenantId);
      if (!mods || mods.includes(moduleKey)) return next();
      return res.status(403).json({
        success: false,
        error: 'Este módulo não está habilitado para a sua empresa.',
      });
    } catch (err) {
      // Fail-open para o comportamento anterior (sem gating) — nunca reduz a
      // segurança abaixo da baseline atual, que não tinha gating de módulo.
      console.error('[requireModule] erro ao validar módulo:', err.message);
      return next();
    }
  };
}

module.exports = { requireModule };
