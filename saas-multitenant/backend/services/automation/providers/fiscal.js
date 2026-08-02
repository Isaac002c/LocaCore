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
const { isProduction } = require('./guard');

// Campos mínimos que o tipo de documento exige (parametrizados; validados pela empresa).
function validateConfig(settings = {}) {
  const missing = [];
  if (!settings.fiscal_document_type) missing.push('tipo de documento fiscal');
  if ((settings.fiscal_provider || 'null') === 'null') missing.push('provedor fiscal');
  const cfg = settings.fiscal_config || {};
  ['municipio', 'cnpj', 'regime_tributario'].forEach((k) => { if (!cfg[k]) missing.push(k); });
  if (settings.fiscal_document_type === 'nfse') {
    // NFS-e via provedor exige, além do cadastro, o código do serviço e a alíquota
    // (decisões do contador). Sem eles não dá pra montar a nota.
    if (!cfg.inscricao_municipal) missing.push('inscricao_municipal');
    if (!cfg.codigo_servico) missing.push('codigo_servico');
    if (cfg.aliquota === undefined || cfg.aliquota === null || cfg.aliquota === '') missing.push('aliquota');
  }
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

// ── FOCUS NFe (REAL) ─────────────────────────────────────────────────────────
// Provedor unificado NF-e/NFS-e (abstrai a prefeitura de cada município). Auth
// HTTP Basic com o token como usuário. Emissão é ASSÍNCRONA: o POST devolve 202
// e o status final ("autorizado") vem depois — por polling (getDocumentStatus).
//
// Foco em NFS-e (locação de veículo, quando o contador define serviço). NF-e de
// locação é atípica (envolve produto/ICMS) — devolve pendência explícita até ser
// mapeada com o contador, em vez de emitir errado.
//
// fiscal_config esperado (tudo validado com o CONTADOR):
//   cnpj, inscricao_municipal, municipio (código IBGE), regime_tributario,
//   codigo_servico (item da lista LC116), aliquota, discriminacao?,
//   codigo_tributario_municipio?
function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }

function buildNfsePayload({ amount, client, settings }) {
  const cfg = settings.fiscal_config || {};
  const tomadorDoc = onlyDigits(client && client.cpf);
  const tomador = tomadorDoc ? {
    [tomadorDoc.length > 11 ? 'cnpj' : 'cpf']: tomadorDoc,
    razao_social: (client && client.name) || undefined,
    email: (client && client.email) || undefined,
  } : undefined;
  return {
    data_emissao: new Date().toISOString(),
    prestador: {
      cnpj: onlyDigits(cfg.cnpj),
      inscricao_municipal: cfg.inscricao_municipal,
      codigo_municipio: onlyDigits(cfg.municipio),
    },
    tomador,
    servico: {
      aliquota: Number(cfg.aliquota) || 0,
      discriminacao: cfg.discriminacao || 'Locação de veículo',
      iss_retido: false,
      item_lista_servico: cfg.codigo_servico,
      codigo_tributario_municipio: cfg.codigo_tributario_municipio || undefined,
      valor_servicos: Number(amount) || 0,
    },
  };
}

// Mapeia o status do Focus NFe → status interno de fiscal_documents.
const FOCUS_STATUS = {
  autorizado: 'authorized',
  cancelado: 'canceled',
  erro_autorizacao: 'error',
  denegado: 'error',
  processando_autorizacao: 'processing',
  enviado: 'processing',
};

function focusNfeProvider({ fetchImpl, secretFn = getSecret, base } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const apiBase = base || secretFn('FISCAL_FOCUSNFE', 'BASE')
    || (isProduction() ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br');
  const token = () => secretFn('FISCAL_FOCUSNFE', 'TOKEN');
  const authHeader = () => 'Basic ' + Buffer.from(`${token()}:`).toString('base64');

  const call = async (method, path, body) => {
    if (!token()) { const e = new Error('Provedor fiscal Focus NFe sem credenciais (FISCAL_FOCUSNFE_TOKEN).'); e.code = 'NO_CREDENTIALS'; throw e; }
    if (!doFetch) throw new Error('fetch indisponível no runtime.');
    const res = await doFetch(`${apiBase}${path}`, {
      method,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, data };
  };

  const mapResult = (ref, data, httpStatus) => {
    const status = FOCUS_STATUS[data.status] || (httpStatus === 202 ? 'processing' : 'error');
    if (status === 'authorized') {
      return {
        status: 'authorized', external_id: ref, number: data.numero, series: data.serie,
        verification_code: data.codigo_verificacao,
        pdf_url: data.url || data.caminho_danfse || data.url_danfse || null,
        xml_url: data.caminho_xml_nota_fiscal || data.url_xml || null,
      };
    }
    if (status === 'error') {
      const erros = data.erros ? (Array.isArray(data.erros) ? data.erros.map((e) => e.mensagem || e).join('; ') : JSON.stringify(data.erros)) : null;
      return { status: 'error', external_id: ref, error_code: data.codigo || `HTTP_${httpStatus}`, error_message: erros || data.mensagem || `Focus NFe HTTP ${httpStatus}` };
    }
    return { status: 'processing', external_id: ref };
  };

  return {
    name: 'focusnfe',
    isSandbox: false,
    requiresConfiguration: true,
    validateConfiguration: (settings) => validateConfig(settings),

    async issueDocument({ ref, amount, document_type, client, settings }) {
      const type = document_type || settings.fiscal_document_type || 'nfse';
      if (type !== 'nfse') {
        return { status: 'pending_configuration', error_code: 'NFE_NOT_MAPPED',
          error_message: 'Emissão NF-e (produto/ICMS) ainda não mapeada — locação normalmente é NFS-e. Defina com o contador.' };
      }
      const reference = ref || `nfse-${Date.now()}`;
      let out;
      try { out = await call('POST', `/v2/nfse?ref=${encodeURIComponent(reference)}`, buildNfsePayload({ amount, client, settings })); }
      catch (e) {
        return { status: e.code === 'NO_CREDENTIALS' ? 'pending_configuration' : 'failed',
          error_code: e.code || 'PROVIDER_ERROR', error_message: e.message };
      }
      return mapResult(reference, out.data, out.httpStatus);
    },

    // Polling do status (a emissão é assíncrona no Focus NFe).
    async getDocumentStatus({ ref }) {
      try {
        const { data, httpStatus } = await call('GET', `/v2/nfse/${encodeURIComponent(ref)}`);
        return mapResult(ref, data, httpStatus);
      } catch (e) { return { status: 'processing', error_message: e.message }; }
    },

    async cancelDocument({ ref, justificativa }) {
      try {
        const { httpStatus } = await call('DELETE', `/v2/nfse/${encodeURIComponent(ref)}`, justificativa ? { justificativa } : undefined);
        return { status: httpStatus < 300 ? 'canceled' : 'cancellation_pending' };
      } catch (_) { return { status: 'cancellation_pending' }; }
    },

    estimateIssueCost(settings) { return Number(settings?.cost_per_fiscal || 0); },
  };
}

function getFiscalProvider(settings = {}, deps = {}) {
  const p = (settings.fiscal_provider || 'null').toLowerCase();
  if (p === 'null' || !p) return nullProvider;
  if (p === 'focusnfe') return focusNfeProvider(deps);
  if (p === 'nfeio')    return realStub('nfeio', 'FISCAL_NFEIO');
  return realStub(p, `FISCAL_${p}`);
}

module.exports = { getFiscalProvider, nullProvider, focusNfeProvider, validateConfig };
