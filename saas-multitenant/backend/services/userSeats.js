'use strict';
// =============================================================================
// userSeats.js — Regras de ASSENTOS de usuário e de CONTA PROTEGIDA.
//
// Duas regras de negócio, num lugar só (as rotas apenas consultam):
//
//   1) ASSENTO — o tenant mantém no máximo `tenants.user_seats` usuários
//      próprios (padrão 4). Parametrizado por tenant, não fixado no código:
//      um plano diferente muda o número sem tocar em lógica.
//
//   2) CONTA PROTEGIDA — a conta do fornecedor (suporte TELUN) tem
//      `users.is_protected = TRUE`. Ela:
//        · NÃO ocupa assento;
//        · NÃO pode ser editada, desativada, ter senha trocada nem excluída
//          pelo tenant — nem por um admin do tenant;
//        · continua VISÍVEL na listagem, identificada como suporte, para que o
//          cliente saiba exatamente quem tem acesso (nada escondido).
//
// A proteção é enforcement de servidor. A UI só reflete o que vem daqui.
// =============================================================================

const pool = require('../config/db');

const DEFAULT_SEATS = 4;

class SeatError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Quantos assentos o tenant contratou (tolerante a bases pré-migração). */
async function getSeatLimit(tenant_id) {
  try {
    const r = await pool.query('SELECT user_seats FROM tenants WHERE id = $1', [tenant_id]);
    const v = parseInt(r.rows[0]?.user_seats, 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SEATS;
  } catch (_) {
    return DEFAULT_SEATS;
  }
}

/** Usuários que OCUPAM assento (exclui as contas protegidas do fornecedor). */
async function countSeatsUsed(tenant_id) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE tenant_id = $1 AND COALESCE(is_protected, FALSE) = FALSE`,
      [tenant_id],
    );
    return Number(r.rows[0]?.n) || 0;
  } catch (_) {
    const r = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1', [tenant_id]);
    return Number(r.rows[0]?.n) || 0;
  }
}

/** Resumo para a UI: usados, limite, disponíveis e quantas contas de suporte. */
async function getSeatUsage(tenant_id) {
  const [limit, used] = await Promise.all([getSeatLimit(tenant_id), countSeatsUsed(tenant_id)]);
  let protegidas = 0;
  try {
    const r = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1 AND COALESCE(is_protected, FALSE) = TRUE',
      [tenant_id],
    );
    protegidas = Number(r.rows[0]?.n) || 0;
  } catch (_) { /* pré-migração */ }
  return {
    limit,
    used,
    available: Math.max(limit - used, 0),
    protected_accounts: protegidas,
    can_create: used < limit,
  };
}

/** A conta é do fornecedor (imutável para o tenant)? */
function isProtectedUser(user) {
  return !!(user && user.is_protected);
}

/**
 * Barra a criação quando os assentos acabaram.
 * @throws {SeatError} 409 com mensagem orientando o que fazer.
 */
async function assertCanCreateUser(tenant_id) {
  const usage = await getSeatUsage(tenant_id);
  if (!usage.can_create) {
    throw new SeatError(
      409,
      `Limite de ${usage.limit} usuários atingido. Exclua ou desative um usuário existente antes de criar outro.`,
    );
  }
  return usage;
}

/**
 * Barra qualquer alteração numa conta protegida.
 * @param {object} user  registro do usuário-alvo
 * @param {string} acao  verbo para a mensagem ('editar', 'excluir', ...)
 * @throws {SeatError} 403
 */
function assertNotProtected(user, acao = 'alterar') {
  if (isProtectedUser(user)) {
    throw new SeatError(
      403,
      `Esta é a conta de suporte da TELUN e não pode ser ${acao === 'excluir' ? 'excluída' : `${acao}da`}. `
      + 'Ela existe para manutenção do sistema e não ocupa uma das vagas de usuário da sua empresa.',
    );
  }
}

module.exports = {
  DEFAULT_SEATS,
  SeatError,
  getSeatLimit,
  countSeatsUsed,
  getSeatUsage,
  isProtectedUser,
  assertCanCreateUser,
  assertNotProtected,
};
