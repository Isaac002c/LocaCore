// =============================================================================
// secrets.js — Resolução de credenciais de provedores externos.
//
// Secrets NUNCA vêm do banco em texto puro. São lidos de variáveis de ambiente /
// secret manager. As settings do tenant guardam apenas a SELEÇÃO do provedor e
// identificadores não-sensíveis; o token real é resolvido aqui, por env.
//
// Convenção de env (por provedor; opcionalmente sufixado por tenant slug em
// MAIÚSCULAS para multi-tenant): ex. WHATSAPP_META_TOKEN, PAYMENT_ASAAS_KEY,
// FISCAL_FOCUSNFE_TOKEN. Nunca logar o valor.
// =============================================================================

const envKey = (parts) => parts.filter(Boolean).map((p) => String(p).toUpperCase().replace(/[^A-Z0-9]/g, '_')).join('_');

// Retorna o secret (ou null). tenantSlug é opcional (permite override por tenant).
function getSecret(scope, name, tenantSlug) {
  if (tenantSlug) {
    const perTenant = process.env[envKey([scope, name, tenantSlug])];
    if (perTenant) return perTenant;
  }
  return process.env[envKey([scope, name])] || null;
}

module.exports = { getSecret };
