const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const paymentConfirm = require('../services/automation/paymentConfirmService');
const whatsappWebhook = require('../services/automation/whatsappWebhookService');
const { getPaymentProvider } = require('../services/automation/providers/payment');
const { getWhatsAppProvider } = require('../services/automation/providers/whatsapp');
const log = require('../services/logger');

// =============================================================================
// Webhooks EXTERNOS (fora de /api → sem JWT). Segurança (§11):
//   * CORPO BRUTO (express.raw) → validação de ASSINATURA pelo adapter do provider
//     (HMAC Meta / token Asaas). Sem assinatura válida → 401.
//   * Idempotência/anti-replay via webhook_events (na camada de serviço).
//   * TENANT resolvido pela cobrança/mensagem, NUNCA pelo payload.
//   * Resposta rápida; processamento pesado é idempotente e pode ser re-disparado.
// =============================================================================

const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
router.use(webhookLimiter);
// Corpo bruto (necessário para HMAC). Limite defensivo de tamanho.
router.use(express.raw({ type: '*/*', limit: '1mb' }));

const parseJson = (raw) => { try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')); } catch { return null; } };

// POST /webhooks/payment/:provider
router.post('/payment/:provider', async (req, res) => {
  const provider = getPaymentProvider({ payment_provider: req.params.provider });
  const sig = provider.verifyWebhookSignature(req.body, req.headers || {});
  if (!sig.valid) { log.warn('webhook.payment.invalid_signature', { provider: provider.name }); return res.status(401).json({ ok: false }); }
  const body = parseJson(req.body);
  if (!body) return res.status(400).json({ ok: false });
  try {
    await paymentConfirm.handleWebhook(req.params.provider, body, {});
    return res.status(200).json({ ok: true });
  } catch (err) {
    log.error('webhook.payment.error', { provider: provider.name, error: err.message });
    return res.status(200).json({ ok: true }); // 200 evita retries em massa; erro logado
  }
});

// POST /webhooks/whatsapp/:provider (status de mensagem)
router.post('/whatsapp/:provider', async (req, res) => {
  const provider = getWhatsAppProvider({ whatsapp_provider: req.params.provider });
  const sig = provider.verifyWebhookSignature(req.body, req.headers || {});
  if (!sig.valid) { log.warn('webhook.whatsapp.invalid_signature', { provider: provider.name }); return res.status(401).json({ ok: false }); }
  const body = parseJson(req.body);
  if (!body) return res.status(400).json({ ok: false });
  try {
    await whatsappWebhook.handleWebhook(req.params.provider, body);
    return res.status(200).json({ ok: true });
  } catch (err) {
    log.error('webhook.whatsapp.error', { provider: provider.name, error: err.message });
    return res.status(200).json({ ok: true });
  }
});

// GET /webhooks/whatsapp/:provider — verificação de assinatura da Meta (hub.challenge)
router.get('/whatsapp/:provider', (req, res) => {
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && verifyToken && req.query['hub.verify_token'] === verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

module.exports = router;
