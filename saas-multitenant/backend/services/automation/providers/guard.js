// =============================================================================
// providers/guard.js — Trava de PRODUÇÃO para adapters SANDBOX (§16).
//
// Os providers 'null' (sandbox) simulam o efeito externo: devolvem
// `status: 'sent'` para WhatsApp e um PIX fictício para cobrança. Isso é
// legítimo em desenvolvimento/teste, mas em PRODUÇÃO registraria no banco uma
// operação que NUNCA aconteceu — e ainda aceitaria webhook sem assinatura.
//
// Regra: com APP_ENV/NODE_ENV = production, o sandbox NÃO opera. Falha com
// PROVIDER_NOT_CONFIGURED (503) para que o fluxo caia em pendência explícita
// (pending_configuration / retry) em vez de fingir sucesso.
// =============================================================================

const isProduction = () => {
  const env = String(process.env.APP_ENV || process.env.NODE_ENV || '').toLowerCase();
  return env === 'production';
};

// Lança quando um adapter sandbox tenta produzir efeito externo em produção.
function assertSandboxAllowed(kind) {
  if (!isProduction()) return;
  const err = new Error(
    `${kind}: adapter sandbox não pode operar em produção. ` +
    'Configure o provedor real e suas credenciais antes de ativar a automação.'
  );
  err.code = 'PROVIDER_NOT_CONFIGURED';
  err.statusCode = 503;
  throw err;
}

// Em produção, o sandbox NUNCA valida assinatura de webhook (aceitaria payload
// forjado). Retorna o motivo para o log/auditoria.
function sandboxSignatureResult() {
  return isProduction()
    ? { valid: false, reason: 'sandbox_provider_disabled_in_production' }
    : { valid: true };
}

module.exports = { isProduction, assertSandboxAllowed, sandboxSignatureResult };
