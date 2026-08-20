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
const https = require('node:https');

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
    if ((settings.fiscal_provider || '').toLowerCase() === 'nfse_nacional') {
      if (!cfg.razao_social) missing.push('razao_social');
      if (!cfg.uf) missing.push('uf');
      if (!cfg.cep) missing.push('cep');
      if (!cfg.codigo_tributacao_nacional) missing.push('codigo_tributacao_nacional');
      if (!cfg.cst_ibs_cbs) missing.push('cst_ibs_cbs');
      if (!cfg.classificacao_tributaria) missing.push('classificacao_tributaria');
      if (!cfg.tratamento_iss) missing.push('tratamento_iss');
      if (!cfg.api_url) missing.push('api_url');
      if (!cfg.issue_path) missing.push('issue_path');
    }
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

function buildNationalDpsPayload({ ref, amount, client, rental, vehicle, settings }) {
  const cfg = settings.fiscal_config || {};
  const document = onlyDigits(client && client.cpf);
  return {
    referencia: ref,
    ambiente: settings.fiscal_environment || 'homologacao',
    emitente: {
      cnpj: onlyDigits(cfg.cnpj), razao_social: cfg.razao_social,
      nome_fantasia: cfg.nome_fantasia || undefined,
      inscricao_municipal: cfg.inscricao_municipal,
      inscricao_estadual: cfg.inscricao_estadual || undefined,
      regime_tributario: cfg.regime_tributario,
      cnaes: Array.isArray(cfg.cnaes) ? cfg.cnaes : undefined,
      endereco: {
        logradouro: cfg.logradouro, numero: cfg.numero, complemento: cfg.complemento || undefined,
        bairro: cfg.bairro, cep: onlyDigits(cfg.cep), codigo_ibge: onlyDigits(cfg.municipio),
        municipio: cfg.nome_municipio, uf: cfg.uf,
      },
      email: cfg.email_fiscal || undefined, telefone: cfg.telefone || undefined,
    },
    tomador: document ? {
      [document.length > 11 ? 'cnpj' : 'cpf']: document,
      nome: client?.name, email: client?.email || undefined, telefone: client?.phone || undefined,
      endereco: {
        cep: onlyDigits(client?.address_zip), logradouro: client?.address_street,
        numero: client?.address_number, complemento: client?.address_complement,
        bairro: client?.address_neighborhood, municipio: client?.address_city,
        uf: client?.address_state, codigo_ibge: onlyDigits(client?.municipality_ibge),
      },
    } : undefined,
    item: {
      categoria: 'locacao', valor: Number(amount),
      descricao: vehicle?.fiscal_description || cfg.discriminacao || 'Locacao de veiculo',
      codigo_tributacao_nacional: cfg.codigo_tributacao_nacional,
      codigo_servico_municipal: cfg.codigo_servico,
      ncm: vehicle?.ncm || undefined,
      cst_ibs_cbs: cfg.cst_ibs_cbs,
      classificacao_tributaria: cfg.classificacao_tributaria,
      tratamento_iss: cfg.tratamento_iss,
      aliquota: Number(cfg.aliquota),
    },
    locacao: rental ? {
      id: rental.id, numero: rental.rental_number,
      periodo_inicio: rental.start_date, periodo_fim: rental.end_date,
      veiculo_placa: vehicle?.plate,
    } : undefined,
  };
}

function mtlsJsonRequest({ url, method = 'POST', body, certificate, token }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(Object.assign(new Error('Endpoint fiscal deve usar HTTPS.'), { code: 'INSECURE_ENDPOINT' }));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port || 443,
      path: `${target.pathname}${target.search}`, method,
      pfx: certificate?.buffer, passphrase: certificate?.password,
      headers: {
        Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 30000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { data = {}; }
        resolve({ httpStatus: response.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timeout no provedor fiscal.'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// REALIDADE DA NFS-e NACIONAL (verificado na documentação oficial gov.br/nfse,
// ago/2026): a emissão direta no Ambiente de Dados Nacional é
//   POST https://sefin.nfse.gov.br/SefinNacional/nfse
// com o corpo = DPS (Declaração de Prestação de Serviços) em XML ASSINADO
// (XMLDSig com certificado ICP-Brasil A1/A3), COMPACTADO em GZip e em Base64,
// sobre mTLS. O Rio de Janeiro aderiu ao sistema nacional (confirmado pela DANFSe
// v2.0 real da Rental). Este adapter monta um PAYLOAD JSON para um endpoint
// PARAMETRIZÁVEL (api_url/issue_path) — pronto para um intermediário que fale o
// layout nacional. Para bater DIRETO no ADN é preciso um passo extra de
// build+assinatura+gzip+base64 do XML da DPS (não incluído: exige certificado e
// não pode ser testado sem ele). Ver relatório: recomendação de intermediário RJ
// vs. construir o assinador da DPS. Nunca emite nota simulada (fail-closed).
function nationalNfseProvider({ secretFn = getSecret, certificate = null, requestImpl = mtlsJsonRequest } = {}) {
  const token = () => secretFn('FISCAL_NFSE_NACIONAL', 'TOKEN');
  const joinUrl = (base, path, ref) => `${String(base).replace(/\/$/, '')}/${String(path).replace(/^\//, '').replace('{ref}', encodeURIComponent(ref))}`;
  const map = (ref, result) => {
    const data = result.data || {};
    const raw = String(data.status || data.situacao || '').toLowerCase();
    const authorized = ['autorizada', 'autorizado', 'authorized', 'emitida'].includes(raw) || (result.httpStatus >= 200 && result.httpStatus < 300 && (data.numero || data.chave_acesso));
    if (authorized) return {
      status: 'authorized', external_id: data.id || data.chave_acesso || ref,
      number: data.numero || data.numero_nfse, series: data.serie,
      verification_code: data.codigo_verificacao || data.chave_acesso,
      pdf_url: data.pdf_url || data.url_danfse, xml_url: data.xml_url,
    };
    if (result.httpStatus === 202 || ['processando', 'processing', 'recebida'].includes(raw)) {
      return { status: 'processing', external_id: data.id || ref };
    }
    return { status: 'error', external_id: data.id || ref,
      error_code: data.codigo || `HTTP_${result.httpStatus}`,
      error_message: data.mensagem || data.message || 'Documento fiscal rejeitado pelo provedor.' };
  };
  return {
    name: 'nfse_nacional', isSandbox: false, requiresConfiguration: true,
    validateConfiguration: validateConfig,
    async issueDocument({ ref, amount, document_type, client, rental, vehicle, settings }) {
      if (document_type !== 'nfse') return { status: 'pending_configuration', error_code: 'UNSUPPORTED_DOCUMENT', error_message: 'O adapter nacional emite somente NFS-e.' };
      if (!certificate) return { status: 'pending_configuration', error_code: 'NO_CERTIFICATE', error_message: 'Certificado A1 ausente.' };
      const cfg = settings.fiscal_config || {};
      try {
        const result = await requestImpl({
          url: joinUrl(cfg.api_url, cfg.issue_path, ref), method: 'POST', certificate, token: token(),
          body: buildNationalDpsPayload({ ref, amount, client, rental, vehicle, settings }),
        });
        return map(ref, result);
      } catch (err) {
        return { status: err.code === 'INSECURE_ENDPOINT' ? 'pending_configuration' : 'failed',
          error_code: err.code || 'PROVIDER_ERROR', error_message: err.message };
      }
    },
    async getDocumentStatus({ ref, settings }) {
      const cfg = settings.fiscal_config || {};
      if (!cfg.status_path) return { status: 'processing' };
      try { return map(ref, await requestImpl({ url: joinUrl(cfg.api_url, cfg.status_path, ref), method: 'GET', certificate, token: token() })); }
      catch (err) { return { status: 'processing', error_message: err.message }; }
    },
    async cancelDocument() { return { status: 'cancellation_pending' }; },
    estimateIssueCost(settings) { return Number(settings?.cost_per_fiscal || 0); },
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
  if (p === 'nfse_nacional') return nationalNfseProvider(deps);
  if (p === 'nfeio')    return realStub('nfeio', 'FISCAL_NFEIO');
  return realStub(p, `FISCAL_${p}`);
}

module.exports = {
  getFiscalProvider, nullProvider, focusNfeProvider, nationalNfseProvider,
  validateConfig, buildNationalDpsPayload, mtlsJsonRequest,
};
