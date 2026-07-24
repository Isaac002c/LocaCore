'use strict';
// Testa a geração real do PDF do recibo (requer pdfkit instalado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReceiptPdf } = require('../services/finance/pdfService');

const receipt = {
  full_number: 'NEXO-000001',
  status: 'emitido',
  issue_date: '2026-07-10',
  client_name: 'José da Conceição Ávila',      // acentos pt-BR
  client_document: '123.456.789-09',
  service_description: 'Defesa prévia de multa de trânsito',
  fine_number: 'AI-2026-0001',
  amount: 1234.56,
  payment_method: 'pix',
  notes: 'Pagamento à vista. Obrigado pela preferência!',
  created_by_name: 'Maria Antônia',
};

const branding = {
  name: 'Locadora Exemplo Ltda',
  document: '12.345.678/0001-90',
  address: 'Rua das Palmeiras, 100 — Centro, Rio de Janeiro/RJ',
  phone: '(21) 99999-0000',
  email: 'contato@exemplo.com',
  logo_url: null,
  signature: 'um produto TELUN',
  is_default: true,
};

test('gera um PDF válido (assinatura %PDF)', async () => {
  const buf = await buildReceiptPdf(receipt, branding);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 800, 'PDF não deve ser trivialmente pequeno');
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('gera PDF de recibo cancelado', async () => {
  const buf = await buildReceiptPdf({ ...receipt, status: 'cancelado', cancel_reason: 'Emitido em duplicidade' }, branding);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
