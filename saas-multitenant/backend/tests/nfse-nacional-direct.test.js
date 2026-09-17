'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const {
  buildDpsXml, signDpsXml, dpsId, issueNationalNfse, OFFICIAL_BASES,
} = require('../services/automation/providers/nfseNacional');

let certificate;

before(() => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  cert.setSubject([{ name: 'commonName', value: 'LocaCore Test' }]);
  cert.setIssuer(cert.subject.attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  certificate = { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
});

const settings = {
  fiscal_environment: 'homologacao', billing_timezone: 'America/Sao_Paulo',
  fiscal_config: {
    cnpj: '45.427.279/0001-22', razao_social: 'RENTAL LOG SERVICE LTDA',
    inscricao_municipal: '13761116', regime_tributario: 'SIMPLES NACIONAL',
    percentual_total_tributos_simples: 6, cst_pis_cofins: '00',
    municipio: '3304557', codigo_tributacao_nacional: '99.01.01',
    codigo_nbs: '1.1101.11.00',
    tratamento_iss: 'nao_incide', dps_series: '00001',
  },
};

const input = {
  amount: 100,
  client: { name: 'Arthur Teste Magno', cpf: '17528951773', phone: '21988841509' },
  rental: { rental_number: 'LOC-TESTE', start_date: '2026-09-07', end_date: '2026-09-13' },
  vehicle: { brand: 'FIAT', model: 'ARGO', plate: 'ABC1D23', ncm: '87032210' },
  settings, dps_number: '1', dps_series: '00001',
  issuedAt: new Date('2026-09-12T15:30:00Z'),
};

test('monta o Id fixo e a DPS 1.01 com não incidência de ISS', () => {
  assert.equal(dpsId({ municipality: '3304557', cnpj: '45427279000122', series: '00001', number: '1' }),
    'DPS330455724542727900012200001000000000000001');
  const built = buildDpsXml(input);
  assert.equal(built.id.length, 45);
  assert.match(built.xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(built.xml, /<dhEmi>2026-09-12T12:30:00-03:00<\/dhEmi>/);
  assert.match(built.xml, /<cTribNac>990101<\/cTribNac>/);
  assert.doesNotMatch(built.xml, /<IM>/, 'item 99 não informa inscrição municipal (evita E0120)');
  assert.doesNotMatch(built.xml.match(/<prest>(.*?)<\/prest>/)[1], /<xNome>/,
    'prestador próprio não informa razão social redundante (evita E0121)');
  assert.match(built.xml, /<xDescServ>.*<\/xDescServ><cNBS>111011100<\/cNBS>/);
  assert.match(built.xml, /<infoCompl><docRef>LOC-TESTE<\/docRef><xInfComp>.*NCM 87032210.*sem incidencia de ISSQN<\/xInfComp><\/infoCompl>/);
  assert.match(built.xml, /<tribISSQN>4<\/tribISSQN><tpRetISSQN>1<\/tpRetISSQN>/);
  assert.doesNotMatch(built.xml, /<pAliq>/, 'não inventa alíquota em operação sem incidência');
  assert.match(built.xml, /<tribFed><piscofins><CST>00<\/CST><\/piscofins><\/tribFed>/);
  assert.match(built.xml, /<totTrib><pTotTribSN>6\.00<\/pTotTribSN><\/totTrib>/,
    'ME/EPP usa o percentual parametrizado no tenant (evita E0712)');
  assert.doesNotMatch(built.xml, /<indTotTrib>/, 'ME/EPP não informa o indicador genérico');
  assert.match(built.xml, /<CPF>17528951773<\/CPF><xNome>Arthur Teste Magno<\/xNome>/);
});

test('assina infDPS em XMLDSig RSA-SHA1/C14N e a assinatura é verificável', () => {
  const built = buildDpsXml(input);
  const { signedXml } = signDpsXml(built.xml, certificate);
  assert.match(signedXml, /rsa-sha1/);
  assert.match(signedXml, /<X509Certificate>/);
  const doc = new DOMParser().parseFromString(signedXml);
  const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const verifier = new SignedXml({ publicCert: certificate.cert, getCertFromKeyInfo: () => null });
  verifier.loadSignature(signature);
  assert.equal(verifier.checkSignature(signedXml), true, verifier.validationErrors?.join('; '));
});

test('emite na SEFIN, descompacta o XML e baixa o DANFSe oficial', async () => {
  const accessKey = '33045572245427279000122000000000000000000000000001';
  const nfseXml = '<?xml version="1.0"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe><nNFSe>123</nNFSe><serie>00001</serie><chNFSe>' + accessKey + '</chNFSe></infNFSe></NFSe>';
  const calls = [];
  const requestImpl = async (request) => {
    calls.push(request);
    if (request.method === 'POST') return {
      httpStatus: 201, headers: { 'content-type': 'application/json' },
      data: { idDps: 'DPS-ID', chaveAcesso: accessKey, nfseXmlGZipB64: zlib.gzipSync(Buffer.from(nfseXml)).toString('base64') },
    };
    return { httpStatus: 200, headers: { 'content-type': 'application/pdf' }, raw: Buffer.from('%PDF-teste'), data: null };
  };
  const result = await issueNationalNfse({ ...input, certificate, requestImpl });
  assert.equal(result.status, 'authorized');
  assert.equal(result.number, '123');
  assert.equal(result.verification_code, accessKey);
  assert.equal(result.pdf_buffer.toString(), '%PDF-teste');
  assert.equal(result.xml_buffer.toString(), nfseXml);
  assert.equal(calls[0].url, `${OFFICIAL_BASES.homologacao.sefin}/nfse`);
  assert.equal(calls[1].url, `${OFFICIAL_BASES.homologacao.adn}/danfse/${accessKey}`);
  const sentDps = zlib.gunzipSync(Buffer.from(calls[0].body.dpsXmlGZipB64, 'base64')).toString();
  assert.match(sentDps, /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
});

test('repete o download do DANFSe enquanto o ADN ainda processa o PDF', async () => {
  const { downloadDanfse } = require('../services/automation/providers/nfseNacional');
  let calls = 0;
  const result = await downloadDanfse({
    accessKey: 'chave', environment: 'homologacao', certificate,
    attempts: 3, retryDelayMs: 1,
    requestImpl: async () => {
      calls += 1;
      return calls < 3
        ? { httpStatus: 404, headers: {}, raw: Buffer.alloc(0) }
        : { httpStatus: 200, headers: { 'content-type': 'application/pdf' }, raw: Buffer.from('%PDF-pronto') };
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.status, 200);
  assert.equal(result.buffer.toString(), '%PDF-pronto');
});

test('rejeição oficial é preservada e nunca vira autorização simulada', async () => {
  const requestImpl = async () => ({
    httpStatus: 400, headers: { 'content-type': 'application/json' }, raw: Buffer.alloc(0),
    data: { erros: [{ Codigo: 'E999', Descricao: 'Código não disponível no ambiente' }] },
  });
  const result = await issueNationalNfse({ ...input, certificate, requestImpl });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error_code, 'E999');
  assert.match(result.error_message, /Código não disponível/);
});

test('E0310 do futuro 99.04.01 orienta o código transitório oficial', async () => {
  const requestImpl = async () => ({
    httpStatus: 400, headers: { 'content-type': 'application/json' }, raw: Buffer.alloc(0),
    data: { erros: [{ Codigo: 'E0310', Descricao: 'Código de tributação nacional 99.04.01 não disponível no ambiente' }] },
  });
  const result = await issueNationalNfse({
    ...input, settings: { ...settings, fiscal_config: { ...settings.fiscal_config, codigo_tributacao_nacional: '99.04.01' } },
    certificate, requestImpl,
  });
  assert.equal(result.status, 'pending_configuration');
  assert.equal(result.error_code, 'NATIONAL_TAX_CODE_PENDING_NT009');
  assert.match(result.error_message, /Use temporariamente 99\.01\.01/);
  assert.equal(result.provider_payload.original_error_code, 'E0310');
});

test('E0310 real da SEFIN sem repetir 99.04.01 também vira pendência da NT 009', async () => {
  const requestImpl = async () => ({
    httpStatus: 400, headers: { 'content-type': 'application/json' }, raw: Buffer.alloc(0),
    data: { erros: [{ Codigo: 'E0310', Descricao: 'O código de tributação nacional informado não existe conforme a lista de serviços nacional do Sistema Nacional NFS-e.' }] },
  });
  const result = await issueNationalNfse({
    ...input, settings: { ...settings, fiscal_config: { ...settings.fiscal_config, codigo_tributacao_nacional: '99.04.01' } },
    certificate, requestImpl,
  });
  assert.equal(result.status, 'pending_configuration');
  assert.equal(result.error_code, 'NATIONAL_TAX_CODE_PENDING_NT009');
  assert.equal(result.provider_payload.original_error_code, 'E0310');
  assert.equal(result.provider_payload.national_tax_code, '990401');
});
