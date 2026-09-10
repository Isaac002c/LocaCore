'use strict';

// Copia a NFS-e autorizada para o storage do LocaCore e a associa à pasta de
// documentos do cliente. O vínculo fiscal_document_id torna a operação
// idempotente; uma retentativa devolve o documento já arquivado.

const crypto = require('node:crypto');
const documentModel = require('../../models/documentModels');
const storageObjects = require('../../models/storageObjectModels');
const { getProvider, safeName } = require('../storage');

const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15000;

function archiveError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function validateSourceUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch (_) { throw archiveError('URL do documento fiscal inválida.', 'INVALID_FISCAL_DOCUMENT_URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw archiveError('Protocolo do documento fiscal não permitido.', 'INVALID_FISCAL_DOCUMENT_URL');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw archiveError('Documento fiscal produtivo precisa usar HTTPS.', 'INSECURE_FISCAL_DOCUMENT_URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || /^127\./.test(host) || /^169\.254\./.test(host)
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw archiveError('Host privado não permitido para arquivamento fiscal.', 'PRIVATE_FISCAL_DOCUMENT_URL');
  }
  return parsed.toString();
}

async function downloadFiscalDocument(sourceUrl, { fetchImpl = global.fetch } = {}) {
  if (!fetchImpl) throw archiveError('Download indisponível no runtime.', 'NO_FETCH');
  const url = validateSourceUrl(sourceUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response;
  try {
    // Nao seguimos redirecionamentos: um provedor comprometido poderia apontar
    // uma URL publica para um host privado e contornar a validacao SSRF acima.
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal });
  } catch (err) {
    throw archiveError(`Não foi possível baixar o documento fiscal: ${err.message}`, 'FISCAL_DOCUMENT_DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw archiveError(`Download fiscal retornou HTTP ${response.status}.`, 'FISCAL_DOCUMENT_DOWNLOAD_FAILED');
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_DOCUMENT_SIZE) throw archiveError('Documento fiscal excede 10 MB.', 'FISCAL_DOCUMENT_TOO_LARGE');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw archiveError('Documento fiscal vazio.', 'EMPTY_FISCAL_DOCUMENT');
  if (buffer.length > MAX_DOCUMENT_SIZE) throw archiveError('Documento fiscal excede 10 MB.', 'FISCAL_DOCUMENT_TOO_LARGE');
  const rawType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType = rawType === 'application/xml' || rawType === 'text/xml'
    ? 'application/xml'
    : 'application/pdf';
  return { buffer, contentType, extension: contentType === 'application/xml' ? '.xml' : '.pdf' };
}

async function archiveAuthorizedFiscal({ tenant_id, fiscal, context, created_by = null }, deps = {}) {
  const docs = deps.documentModel || documentModel;
  const objects = deps.storageObjects || storageObjects;
  const provider = deps.storageProvider || getProvider();
  if (!tenant_id || !fiscal?.id || !context?.client_id) {
    return { archived: false, reason: 'missing_context' };
  }
  const existing = await docs.getDocumentByFiscal(fiscal.id, tenant_id);
  if (existing) return { archived: true, created: false, document: existing };

  const sourceUrl = fiscal.pdf_url || fiscal.xml_url;
  if (!sourceUrl) return { archived: false, reason: 'provider_document_unavailable' };
  const downloaded = await downloadFiscalDocument(sourceUrl, { fetchImpl: deps.fetchImpl });
  const number = String(fiscal.number || fiscal.external_id || fiscal.id).replace(/[\\/:*?"<>|]/g, '-');
  const displayName = `NFS-e ${number}${downloaded.extension}`;
  const key = safeName(displayName);
  const stored = await provider.put({
    tenantId: tenant_id, key, buffer: downloaded.buffer, contentType: downloaded.contentType,
  });
  const fileUrl = provider.publicUrl({ tenantId: tenant_id, key, bucket: stored.bucket });
  if (!fileUrl) throw archiveError('Storage não devolveu uma URL para a nota.', 'STORAGE_URL_UNAVAILABLE');

  await objects.record({
    tenant_id, provider: stored.provider, bucket: stored.bucket,
    object_key: `${tenant_id}/${key}`, category: 'nota_fiscal', entity_type: 'client',
    entity_id: context.client_id, file_name: displayName, content_type: downloaded.contentType,
    size: downloaded.buffer.length,
    checksum: crypto.createHash('sha256').update(downloaded.buffer).digest('hex'),
    created_by,
  }).catch(() => null);

  try {
    const document = await docs.createDocument({
      tenant_id, client_id: context.client_id, rental_id: context.rental_id || null,
      vehicle_asset_id: context.vehicle?.id || null, fiscal_document_id: fiscal.id,
      file_url: fileUrl, file_name: displayName, file_type: downloaded.contentType,
      file_size: downloaded.buffer.length, category: 'nota_fiscal',
      description: `NFS-e ${number} arquivada automaticamente após confirmação do pagamento.`,
      uploaded_by: created_by,
    });
    return { archived: true, created: true, document };
  } catch (err) {
    if (err.code === '23505') {
      const raced = await docs.getDocumentByFiscal(fiscal.id, tenant_id);
      if (raced) return { archived: true, created: false, document: raced };
    }
    throw err;
  }
}

module.exports = {
  archiveAuthorizedFiscal, downloadFiscalDocument, validateSourceUrl,
  MAX_DOCUMENT_SIZE, DOWNLOAD_TIMEOUT_MS,
};
