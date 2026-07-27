'use strict';
// =============================================================================
// PRODUÇÃO — trava dos adapters SANDBOX (§16). Em APP_ENV=production o provider
// 'null' NÃO pode simular envio de WhatsApp nem gerar PIX fictício, e NÃO pode
// validar webhook sem assinatura. Fora de produção, segue funcionando normal.
// =============================================================================

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { getWhatsAppProvider } = require('../services/automation/providers/whatsapp');
const { getPaymentProvider } = require('../services/automation/providers/payment');

const setEnv = (v) => { if (v === null) { delete process.env.APP_ENV; } else { process.env.APP_ENV = v; } };
afterEach(() => setEnv(null));

test('dev/teste: sandbox WhatsApp simula envio normalmente', async () => {
  setEnv('development');
  const p = getWhatsAppProvider({ whatsapp_provider: 'null' });
  const r = await p.sendTemplateMessage({ to: '5511999998888' });
  assert.equal(r.status, 'sent');
  assert.match(r.external_id, /^sandbox-wa-/);
});

test('produção: sandbox WhatsApp RECUSA enviar (PROVIDER_NOT_CONFIGURED)', async () => {
  setEnv('production');
  const p = getWhatsAppProvider({ whatsapp_provider: 'null' });
  await assert.rejects(
    () => p.sendTemplateMessage({ to: '5511999998888' }),
    (e) => {
      assert.equal(e.code, 'PROVIDER_NOT_CONFIGURED');
      assert.equal(e.statusCode, 503);
      return true;
    },
    'não pode fingir envio em produção'
  );
});

test('produção: sandbox de cobrança RECUSA gerar PIX fictício', async () => {
  setEnv('production');
  const p = getPaymentProvider({ payment_provider: 'null' });
  await assert.rejects(
    () => p.createCharge({ amount: 100, due_date: '2027-01-10' }),
    (e) => { assert.equal(e.code, 'PROVIDER_NOT_CONFIGURED'); return true; }
  );
});

test('dev: sandbox de cobrança gera PIX fictício normalmente', async () => {
  setEnv('test');
  const p = getPaymentProvider({ payment_provider: 'null' });
  const c = await p.createCharge({ amount: 100, due_date: '2027-01-10' });
  assert.match(c.external_id, /^sandbox-chg-/);
  assert.equal(c.status, 'pending');
});

test('produção: sandbox NÃO valida assinatura de webhook (evita payload forjado)', () => {
  setEnv('production');
  const wa = getWhatsAppProvider({ whatsapp_provider: 'null' });
  const pay = getPaymentProvider({ payment_provider: 'null' });
  const rw = wa.verifyWebhookSignature('{}', {});
  const rp = pay.verifyWebhookSignature('{}', {});
  assert.equal(rw.valid, false, 'WhatsApp: assinatura inválida em produção');
  assert.equal(rp.valid, false, 'Cobrança: assinatura inválida em produção');
  assert.match(rw.reason, /production/);
});

test('dev: sandbox aceita webhook sem assinatura (comportamento de teste)', () => {
  setEnv('development');
  assert.equal(getWhatsAppProvider({ whatsapp_provider: 'null' }).verifyWebhookSignature('{}', {}).valid, true);
});
