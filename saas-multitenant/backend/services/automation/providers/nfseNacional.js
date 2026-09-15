'use strict';

// Integração direta com o Emissor Público Nacional de NFS-e (SEFIN/ADN).
// Leiaute vigente: DPS/NFS-e 1.01. A DPS é assinada em XMLDSig, compactada em
// GZip e enviada em Base64 sobre mTLS com o certificado A1 do próprio tenant.

const https = require('node:https');
const zlib = require('node:zlib');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');

const XMLNS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
const XMLNS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const LAYOUT_VERSION = '1.01';
const APPLICATION_VERSION = 'LocaCore_1.0';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

const OFFICIAL_BASES = Object.freeze({
  homologacao: Object.freeze({
    sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
    adn: 'https://adn.producaorestrita.nfse.gov.br',
  }),
  producao: Object.freeze({
    sefin: 'https://sefin.nfse.gov.br/SefinNacional',
    adn: 'https://adn.nfse.gov.br',
  }),
});

function onlyDigits(value) { return String(value || '').replace(/\D/g, ''); }

function validCpf(value) {
  const digits = onlyDigits(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (let position = 9; position < 11; position++) {
    let sum = 0;
    for (let i = 0; i < position; i++) sum += Number(digits[i]) * (position + 1 - i);
    let check = (sum * 10) % 11;
    if (check === 10) check = 0;
    if (check !== Number(digits[position])) return false;
  }
  return true;
}

function validCnpj(value) {
  const digits = onlyDigits(value);
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  const calculate = (length) => {
    let factor = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(digits[i]) * factor--;
      if (factor < 2) factor = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(digits[12]) && calculate(13) === Number(digits[13]);
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function tag(name, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function normalizeEnvironment(value) {
  const raw = String(value || 'homologacao').toLowerCase();
  return ['producao', 'production', 'prod'].includes(raw) ? 'producao' : 'homologacao';
}

function normalizeNationalTaxCode(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 6) {
    const err = new Error('Código de tributação nacional deve conter 6 dígitos.');
    err.code = 'INVALID_NATIONAL_TAX_CODE';
    throw err;
  }
  return digits;
}

function normalizeSeries(value) {
  const digits = onlyDigits(value);
  // O XSD 1.01 publicado contém uma expressão incompatível com séries como
  // 90001; a própria SEFIN aceita a forma de cinco posições 00001. Mantemos a
  // série produtiva nessa representação já verificada em homologação.
  if (!/^0000[1-9]$/.test(digits)) {
    const err = new Error('Série da DPS deve usar o formato oficial compatível 00001 a 00009.');
    err.code = 'INVALID_DPS_SERIES';
    throw err;
  }
  return digits;
}

function normalizeDpsNumber(value) {
  const digits = onlyDigits(value);
  if (!digits || digits.length > 15 || Number(digits) < 1) {
    const err = new Error('Número da DPS deve conter de 1 a 15 dígitos e ser maior que zero.');
    err.code = 'INVALID_DPS_NUMBER';
    throw err;
  }
  return digits.replace(/^0+(?=\d)/, '');
}

function formatDateTimeInZone(date = new Date(), timeZone = 'America/Sao_Paulo') {
  const instant = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(instant.getTime())) throw new Error('Data de emissão inválida.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((representedAsUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function dpsId({ municipality, cnpj, series, number }) {
  const mun = onlyDigits(municipality);
  const federal = onlyDigits(cnpj);
  if (mun.length !== 7) throw Object.assign(new Error('Código IBGE do município deve conter 7 dígitos.'), { code: 'INVALID_MUNICIPALITY' });
  if (!validCnpj(federal)) throw Object.assign(new Error('CNPJ do prestador é inválido.'), { code: 'INVALID_ISSUER_CNPJ' });
  // Tipo de inscrição federal 2 = CNPJ. A série e o número ocupam posições
  // fixas no Id, ainda que seus elementos XML sejam enviados sem zeros à esquerda.
  return `DPS${mun}2${federal}${normalizeSeries(series).padStart(5, '0')}${normalizeDpsNumber(number).padStart(15, '0')}`;
}

function simpleNationalRegime(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('mei')) return { opSimpNac: '2', regEspTrib: '0' };
  if (normalized.includes('simples')) return { opSimpNac: '3', regApTribSN: '1', regEspTrib: '0' };
  return { opSimpNac: '1', regEspTrib: '0' };
}

function serviceDescription({ cfg, rental, vehicle, amount }) {
  if (cfg.discriminacao) return String(cfg.discriminacao).slice(0, 2000);
  const parts = ['Locacao de veiculo'];
  if (vehicle?.plate) parts.push(`placa ${String(vehicle.plate).toUpperCase()}`);
  if (rental?.rental_number) parts.push(`contrato ${rental.rental_number}`);
  if (rental?.start_date && rental?.end_date) parts.push(`periodo de ${String(rental.start_date).slice(0, 10)} a ${String(rental.end_date).slice(0, 10)}`);
  parts.push(`valor R$ ${Number(amount || 0).toFixed(2).replace('.', ',')}`);
  return parts.join(', ').slice(0, 2000);
}

function buildDpsXml({ amount, client, rental, vehicle, billing, settings, dps_number, dps_series, issuedAt = new Date() }) {
  const cfg = settings.fiscal_config || {};
  const environment = normalizeEnvironment(settings.fiscal_environment);
  const municipality = onlyDigits(cfg.municipio);
  const cnpj = onlyDigits(cfg.cnpj);
  const series = normalizeSeries(dps_series || cfg.dps_series);
  const number = normalizeDpsNumber(dps_number);
  const id = dpsId({ municipality, cnpj, series, number });
  const clientDocument = onlyDigits(client?.cpf || client?.cnpj);
  const clientDocumentTag = clientDocument.length === 14 ? 'CNPJ' : 'CPF';
  if (!((clientDocument.length === 11 && validCpf(clientDocument))
    || (clientDocument.length === 14 && validCnpj(clientDocument)))) {
    throw Object.assign(new Error('CPF/CNPJ do tomador é inválido.'), { code: 'INVALID_CUSTOMER_DOCUMENT' });
  }
  const regime = simpleNationalRegime(cfg.regime_tributario);
  const nationalCode = normalizeNationalTaxCode(cfg.codigo_tributacao_nacional);
  const municipalCode = onlyDigits(cfg.codigo_servico);
  const treatment = String(cfg.tratamento_iss || '').toLowerCase();
  const tribISSQN = treatment === 'nao_incide' || treatment === 'nao_incidente' ? '4'
    : treatment === 'imune' ? '2' : treatment === 'exportacao' ? '3' : '1';
  const amountValue = Number(amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) {
    throw Object.assign(new Error('Valor da NFS-e deve ser maior que zero.'), { code: 'INVALID_FISCAL_AMOUNT' });
  }
  const issueDateTime = formatDateTimeInZone(issuedAt, settings.billing_timezone || cfg.timezone || 'America/Sao_Paulo');
  // Competência é o início da prestação. Para cobrança semanal, usa primeiro o
  // período do faturamento; nunca usa o fim do contrato (que pode ser futuro).
  const competence = String(cfg.competencia || billing?.period_start || rental?.period_start
    || rental?.start_date || issueDateTime.slice(0, 10)).slice(0, 10);
  const providerPhone = onlyDigits(cfg.telefone);
  const clientPhone = onlyDigits(client?.phone);
  const description = serviceDescription({ cfg, rental, vehicle, amount: amountValue });
  const municipalTag = municipalCode.length === 3 ? tag('cTribMun', municipalCode) : '';
  const aliquota = cfg.aliquota === undefined || cfg.aliquota === null || cfg.aliquota === ''
    ? '' : tag('pAliq', Number(cfg.aliquota).toFixed(2));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<DPS xmlns="${XMLNS_NFSE}" versao="${LAYOUT_VERSION}">`,
    `<infDPS Id="${id}">`,
    tag('tpAmb', environment === 'producao' ? '1' : '2'),
    tag('dhEmi', issueDateTime),
    tag('verAplic', APPLICATION_VERSION),
    tag('serie', series),
    tag('nDPS', number),
    tag('dCompet', competence),
    tag('tpEmit', '1'),
    tag('cLocEmi', municipality),
    '<prest>',
    tag('CNPJ', cnpj),
    tag('IM', cfg.inscricao_municipal),
    tag('xNome', cfg.razao_social),
    providerPhone ? tag('fone', providerPhone) : '',
    cfg.email_fiscal ? tag('email', cfg.email_fiscal) : '',
    '<regTrib>', tag('opSimpNac', regime.opSimpNac), tag('regApTribSN', regime.regApTribSN),
    tag('regEspTrib', regime.regEspTrib), '</regTrib>',
    '</prest>',
    '<toma>', tag(clientDocumentTag, clientDocument), tag('xNome', client?.name),
    clientPhone ? tag('fone', clientPhone) : '', client?.email ? tag('email', client.email) : '', '</toma>',
    '<serv><locPrest>', tag('cLocPrestacao', municipality), '</locPrest><cServ>',
    tag('cTribNac', nationalCode), municipalTag, tag('xDescServ', description), '</cServ></serv>',
    '<valores><vServPrest>', tag('vServ', amountValue.toFixed(2)), '</vServPrest><trib><tribMun>',
    tag('tribISSQN', tribISSQN), tag('tpRetISSQN', '1'), tribISSQN === '1' ? aliquota : '',
    '</tribMun><totTrib>', tag('indTotTrib', '0'), '</totTrib></trib></valores>',
    '</infDPS></DPS>',
  ].join('');
  return { xml, id, series, number, environment, nationalCode, issueDateTime, competence };
}

function certificatePem(certificate) {
  if (certificate?.key && certificate?.cert) return { key: certificate.key, cert: certificate.cert };
  if (!certificate?.buffer) throw Object.assign(new Error('Certificado A1 ausente.'), { code: 'NO_CERTIFICATE' });
  const asn1 = forge.asn1.fromDer(Buffer.from(certificate.buffer).toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, certificate.password || '');
  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keyBag = shrouded[0] || plain[0];
  const certBag = certs.find((bag) => bag.cert?.publicKey?.n?.compareTo?.(keyBag?.key?.n) === 0) || certs[0];
  if (!keyBag?.key || !certBag?.cert) {
    throw Object.assign(new Error('PFX não contém chave privada e certificado utilizáveis.'), { code: 'INVALID_CERTIFICATE' });
  }
  return { key: forge.pki.privateKeyToPem(keyBag.key), cert: forge.pki.certificateToPem(certBag.cert) };
}

function signDpsXml(unsignedXml, certificate) {
  const pem = certificatePem(certificate);
  const signer = new SignedXml({
    privateKey: pem.key,
    publicCert: pem.cert,
    getKeyInfoContent: SignedXml.getKeyInfoContent,
  });
  signer.canonicalizationAlgorithm = C14N;
  signer.signatureAlgorithm = RSA_SHA1;
  signer.addReference({
    xpath: "//*[local-name(.)='infDPS']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
  });
  signer.computeSignature(unsignedXml, {
    location: { reference: "//*[local-name(.)='infDPS']", action: 'after' },
  });
  return { signedXml: signer.getSignedXml(), pem };
}

function parseJson(buffer) {
  try { return JSON.parse(Buffer.from(buffer || '').toString('utf8') || '{}'); }
  catch (_) { return {}; }
}

function mtlsRequest({ url, method = 'GET', body, certificate, headers = {}, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') {
      return reject(Object.assign(new Error('Endpoint fiscal deve usar HTTPS.'), { code: 'INSECURE_ENDPOINT' }));
    }
    let pem;
    try { pem = certificatePem(certificate); } catch (err) { return reject(err); }
    const payload = body === undefined || body === null ? null
      : Buffer.from(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const req = https.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port || 443,
      path: `${target.pathname}${target.search}`, method, key: pem.key, cert: pem.cert,
      headers: {
        Accept: 'application/json, application/pdf, application/xml',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
      }, timeout,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        resolve({
          httpStatus: response.statusCode, headers: response.headers, raw,
          data: contentType.includes('json') || /^[\s\r\n]*[\[{]/.test(raw.toString('utf8')) ? parseJson(raw) : null,
        });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timeout na API nacional de NFS-e.'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function decodeGzipBase64(value) {
  if (!value) return null;
  return zlib.gunzipSync(Buffer.from(String(value), 'base64'));
}

function elementText(xml, localName) {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml), 'application/xml');
  const nodes = doc.getElementsByTagNameNS('*', localName);
  return nodes?.[0]?.textContent || doc.getElementsByTagName(localName)?.[0]?.textContent || null;
}

function providerError(result) {
  const data = result?.data || {};
  const errors = Array.isArray(data.erros) ? data.erros : [];
  const firstCode = errors[0]?.codigo || errors[0]?.Codigo || data.codigo || data.Codigo || `HTTP_${result?.httpStatus || 0}`;
  const message = errors.map((item) => [item.codigo || item.Codigo, item.descricao || item.Descricao,
    item.complemento || item.Complemento].filter(Boolean).join(' - ')).join('; ')
    || data.mensagem || data.message || `API nacional retornou HTTP ${result?.httpStatus || 0}.`;
  const taxCodePending = String(firstCode).toUpperCase() === 'E0310' && /99\.?04\.?01|990401/i.test(message);
  return {
    status: taxCodePending ? 'pending_configuration'
      : (result?.httpStatus >= 400 && result?.httpStatus < 500 ? 'rejected' : 'failed'),
    error_code: taxCodePending ? 'NATIONAL_TAX_CODE_PENDING_NT009' : firstCode,
    error_message: taxCodePending
      ? `O código 99.04.01 está correto para locação de bens móveis, mas ainda não foi disponibilizado pela Plataforma Nacional (retorno E0310). Não substituir por 99.01.01. Resposta original: ${message}`
      : message,
    provider_payload: { http_status: result?.httpStatus || null, errors, original_error_code: taxCodePending ? firstCode : null },
  };
}

async function downloadDanfse({ accessKey, environment, certificate, requestImpl = mtlsRequest }) {
  if (!accessKey) return { buffer: null, status: null };
  const base = OFFICIAL_BASES[normalizeEnvironment(environment)].adn;
  const result = await requestImpl({
    url: `${base}/danfse/${encodeURIComponent(accessKey)}`, method: 'GET', certificate,
    headers: { Accept: 'application/pdf' },
  });
  const type = String(result.headers?.['content-type'] || '').toLowerCase();
  if (result.httpStatus === 200 && (type.includes('pdf') || result.raw?.subarray(0, 4).toString() === '%PDF')) {
    return { buffer: result.raw, status: 200 };
  }
  return { buffer: null, status: result.httpStatus || null };
}

async function issueNationalNfse({ amount, client, rental, vehicle, billing, settings, dps_number, dps_series, certificate,
  requestImpl = mtlsRequest, issuedAt }) {
  // A SEFIN compara o relógio do emissor com o seu próprio servidor e rejeita
  // qualquer milissegundo aparente no futuro. Uma margem curta tolera drift de
  // relógio/rede sem alterar a competência fiscal.
  const effectiveIssuedAt = issuedAt || new Date(Date.now() - 120000);
  const built = buildDpsXml({ amount, client, rental, vehicle, billing, settings, dps_number, dps_series, issuedAt: effectiveIssuedAt });
  const { signedXml } = signDpsXml(built.xml, certificate);
  const dpsXmlGZipB64 = zlib.gzipSync(Buffer.from(signedXml, 'utf8')).toString('base64');
  const base = OFFICIAL_BASES[built.environment].sefin;
  const response = await requestImpl({
    url: `${base}/nfse`, method: 'POST', certificate,
    body: { dpsXmlGZipB64 }, headers: { Accept: 'application/json' },
  });
  if (response.httpStatus !== 201) return { ...providerError(response), signed_dps_buffer: Buffer.from(signedXml) };

  const data = response.data || {};
  const xmlBuffer = decodeGzipBase64(data.nfseXmlGZipB64);
  const accessKey = data.chaveAcesso || elementText(xmlBuffer, 'chNFSe') || elementText(xmlBuffer, 'chaveAcesso');
  const number = elementText(xmlBuffer, 'nNFSe');
  const series = elementText(xmlBuffer, 'serie') || built.series;
  let danfse = { buffer: null, status: null };
  try {
    danfse = await downloadDanfse({ accessKey, environment: built.environment, certificate, requestImpl });
  } catch (_) {
    // A autorização fiscal é soberana. Falha transitória no PDF não desfaz a nota;
    // o XML oficial continua arquivável e o download pode ser repetido depois.
  }
  return {
    status: 'authorized', provider_status: 'authorized',
    external_id: accessKey || data.idDps || built.id,
    number: number || null, series, verification_code: accessKey || null,
    issue_date: built.issueDateTime,
    pdf_url: accessKey ? `${OFFICIAL_BASES[built.environment].adn}/danfse/${encodeURIComponent(accessKey)}` : null,
    xml_url: accessKey ? `${base}/nfse/${encodeURIComponent(accessKey)}` : null,
    pdf_buffer: danfse.buffer, xml_buffer: xmlBuffer,
    signed_dps_buffer: Buffer.from(signedXml, 'utf8'),
    provider_payload: {
      http_status: response.httpStatus, id_dps: data.idDps || built.id,
      access_key: accessKey || null, dps_number: built.number, dps_series: built.series,
      environment: built.environment, layout_version: LAYOUT_VERSION,
      national_tax_code: built.nationalCode, danfse_http_status: danfse.status,
    },
  };
}

async function getNationalNfse({ accessKey, environment, certificate, requestImpl = mtlsRequest }) {
  if (!accessKey) return { status: 'processing' };
  const env = normalizeEnvironment(environment);
  const base = OFFICIAL_BASES[env].sefin;
  const response = await requestImpl({ url: `${base}/nfse/${encodeURIComponent(accessKey)}`, method: 'GET', certificate });
  if (response.httpStatus === 404) return { status: 'processing' };
  if (response.httpStatus !== 200) return providerError(response);
  const data = response.data || {};
  const xmlBuffer = decodeGzipBase64(data.nfseXmlGZipB64);
  return {
    status: 'authorized', external_id: data.chaveAcesso || accessKey,
    number: elementText(xmlBuffer, 'nNFSe'), verification_code: data.chaveAcesso || accessKey,
    xml_buffer: xmlBuffer,
  };
}

module.exports = {
  XMLNS_NFSE, XMLNS_DSIG, LAYOUT_VERSION, APPLICATION_VERSION, OFFICIAL_BASES,
  buildDpsXml, signDpsXml, certificatePem, dpsId, formatDateTimeInZone,
  normalizeNationalTaxCode, normalizeEnvironment, mtlsRequest,
  issueNationalNfse, getNationalNfse, downloadDanfse, decodeGzipBase64, elementText,
  validCpf, validCnpj,
};
