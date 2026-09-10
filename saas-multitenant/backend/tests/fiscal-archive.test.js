'use strict';

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { archiveAuthorizedFiscal, validateSourceUrl } = require('../services/automation/fiscalArchiveService');

test('arquiva a NFS-e no storage e cria um documento vinculado ao cliente', async () => {
  let existing = null;
  let fetchOptions = null;
  const savedObjects = [];
  const documentModel = {
    getDocumentByFiscal: async () => existing,
    createDocument: async (input) => { existing = { id: 'doc-1', ...input }; return existing; },
  };
  const storageProvider = {
    put: async ({ tenantId, key, buffer, contentType }) => {
      assert.equal(tenantId, 'tenant-1');
      assert.equal(buffer.toString(), '%PDF-piloto');
      assert.equal(contentType, 'application/pdf');
      return { provider: 'local', bucket: null, key };
    },
    publicUrl: ({ tenantId, key }) => `https://locacore.example/uploads/${tenantId}/${key}`,
  };
  const fetchImpl = async (_url, options) => {
    fetchOptions = options;
    return ({
    ok: true, status: 200,
    headers: { get: (name) => name === 'content-type' ? 'application/pdf' : null },
    arrayBuffer: async () => Buffer.from('%PDF-piloto'),
    });
  };
  const storageObjects = { record: async (row) => { savedObjects.push(row); return row; } };
  const input = {
    tenant_id: 'tenant-1', fiscal: { id: 'fiscal-1', number: '2026/99', pdf_url: 'https://fiscal.example/nfse/99.pdf' },
    context: { client_id: 'client-1', rental_id: 'rental-1', vehicle: { id: 'vehicle-1' } },
    created_by: 'user-1',
  };

  const first = await archiveAuthorizedFiscal(input, { documentModel, storageProvider, storageObjects, fetchImpl });
  assert.equal(first.archived, true);
  assert.equal(first.created, true);
  assert.equal(first.document.client_id, 'client-1');
  assert.equal(first.document.rental_id, 'rental-1');
  assert.equal(first.document.fiscal_document_id, 'fiscal-1');
  assert.equal(first.document.category, 'nota_fiscal');
  assert.equal(savedObjects.length, 1);
  assert.equal(fetchOptions.redirect, 'error', 'não segue redirect para evitar bypass SSRF');

  const second = await archiveAuthorizedFiscal(input, { documentModel, storageProvider, storageObjects, fetchImpl });
  assert.equal(second.created, false);
  assert.equal(second.document.id, 'doc-1');
  assert.equal(savedObjects.length, 1, 'não baixa nem grava uma segunda cópia');
});

test('arquivamento bloqueia URL local/privada', () => {
  assert.throws(() => validateSourceUrl('http://127.0.0.1/nota.pdf'), (err) => err.code === 'PRIVATE_FISCAL_DOCUMENT_URL');
  assert.throws(() => validateSourceUrl('file:///tmp/nota.pdf'), (err) => err.code === 'INVALID_FISCAL_DOCUMENT_URL');
});
