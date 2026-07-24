// =============================================================================
// providers/fiscal.js — FiscalProvider (desacoplado): emissão fiscal.
//   validateConfiguration, issueDocument, getDocumentStatus, cancelDocument, estimateIssueCost
//
// IMPORTANTE (§3 do escopo): o sistema NÃO assume NF-e/NFS-e nem emite documento
// produtivo com valores inferidos ou sem credenciais. O default 'null' retorna
// SEMPRE 'pending_configuration' — nunca fabrica número/autorização fiscal.
// Provedores reais (focusnfe/nfe.io/...) exigem credenciais + validação contábil.
// =============================================================================

const { getSecret } = require('../secrets');

// Campos mínimos que o tipo de documento exige (parametrizados; validados pela empresa).
function validateConfig(settings = {}) {
  const missing = [];
  if (!settings.fiscal_document_type) missing.push('tipo de documento fiscal');
  if ((settings.fiscal_provider || 'null') === 'null') missing.push('provedor fiscal');
  const cfg = settings.fiscal_config || {};
  ['municipio', 'cnpj', 'regime_tributario'].forEach((k) => { if (!cfg[k]) missing.push(k); });
  if (settings.fiscal_document_type === 'nfse' && !cfg.inscricao_municipal) missing.push('inscricao_municipal');
  return { ok: missing.length === 0, missing };
}

const nullProvider = {
  name: 'null',
  isSandbox: true,
  requiresConfiguration: true,
  validateConfiguration: (settings) => validateConfig(settings),
  // Não emite: devolve pendência de configuração (honesto — sem provedor/credenciais).
  async issueDocument() {
    return {
      status: 'pending_configuration',
      error_code: 'NO_PROVIDER',
      error_message: 'Emissão fiscal não configurada: defina provedor, credenciais e dados fiscais (validar com o contador).',
    };
  },
  async getDocumentStatus() { return { status: 'pending_configuration' }; },
  async cancelDocument() { return { status: 'cancellation_pending' }; },
  estimateIssueCost(settings) { return Number(settings?.cost_per_fiscal || 0); },
};

function realStub(name, envScope) {
  return {
    name,
    isSandbox: false,
    requiresConfiguration: true,
    validateConfiguration: (settings) => validateConfig(settings),
    async issueDocument() {
      const token = getSecret(envScope, 'TOKEN');
      return {
        status: token ? 'failed' : 'pending_configuration',
        error_code: token ? 'NOT_IMPLEMENTED' : 'NO_CREDENTIALS',
        error_message: token
          ? `Integração fiscal "${name}" ainda não implementada.`
          : `Provedor fiscal "${name}" sem credenciais (defina ${envScope.toUpperCase()}_TOKEN).`,
      };
    },
    async getDocumentStatus() { return { status: 'pending' }; },
    async cancelDocument() { return { status: 'cancellation_pending' }; },
    estimateIssueCost(settings) { return Number(settings?.cost_per_fiscal || 0); },
  };
}

function getFiscalProvider(settings = {}) {
  const p = (settings.fiscal_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return nullProvider;
  if (p === 'focusnfe') return realStub('focusnfe', 'FISCAL_FOCUSNFE');
  if (p === 'nfeio')    return realStub('nfeio', 'FISCAL_NFEIO');
  return realStub(p, `FISCAL_${p}`);
}

module.exports = { getFiscalProvider, nullProvider, validateConfig };
