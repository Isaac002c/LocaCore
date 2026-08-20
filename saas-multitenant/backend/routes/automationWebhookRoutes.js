'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const paymentConfirm = require('../services/automation/paymentConfirmService');
const whatsappWebhook = require('../services/automation/whatsappWebhookService');
const automationModels = require('../models/automationModels');
const secretStore = require('../services/automation/secretStore');
const tenantModel = require('../models/tenantModels');
const { safeEqual } = require('../services/automation/webhookSecurity');
const log = require('../services/logger');

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));
router.use(express.raw({ type: '*/*', limit: '1mb' }));

const parseJson = (raw) => {
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')); }
  catch (_) { return null; }
};

async function paymentHandler(provider, req, res) {
  const body = parseJson(req.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false });
  try {
    const result = await paymentConfirm.handleWebhook(provider, body, {
      rawBody: req.body, headers: req.headers || {},
    });
    return res.status(200).json({ ok: true, duplicate: !!result.duplicate });
  } catch (err) {
    const status = err.statusCode === 401 ? 401 : 500;
    log.error('webhook.payment.error', { provider, code: err.code || null, error: String(err.message).slice(0, 300) });
    return res.status(status).json({ ok: false });
  }
}

router.post('/infinitepay', (req, res) => paymentHandler('infinitepay', req, res));
router.post('/payment/:provider', (req, res) => paymentHandler(req.params.provider, req, res));

router.post('/whatsapp/:provider', async (req, res) => {
  const body = parseJson(req.body);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false });
  try {
    const result = await whatsappWebhook.handleWebhook(req.params.provider, body, {
      rawBody: req.body, headers: req.headers || {},
    });
    return res.status(200).json({ ok: true, duplicate: !!result.duplicate });
  } catch (err) {
    const status = err.statusCode === 401 ? 401 : 500;
    log.error('webhook.whatsapp.error', { provider: req.params.provider, error: String(err.message).slice(0, 300) });
    return res.status(status).json({ ok: false });
  }
});

// URL por tenant para o handshake da Meta. A URL contém somente o UUID público
// do tenant; o token continua cifrado e a comparação é timing-safe.
router.get('/whatsapp/meta/:tenantId', async (req, res) => {
  try {
    if (req.query['hub.mode'] !== 'subscribe' || !req.query['hub.challenge']) return res.sendStatus(403);
    const settings = await automationModels.getSettings(req.params.tenantId);
    if (!settings || String(settings.whatsapp_provider).toLowerCase() !== 'meta') return res.sendStatus(403);
    const tenant = await tenantModel.getTenantById(req.params.tenantId).catch(() => null);
    const stored = await secretStore.getSecrets(req.params.tenantId, 'whatsapp:meta');
    const expected = secretStore.resolver(stored, tenant?.slug)('META_WHATSAPP', 'VERIFY_TOKEN');
    const supplied = req.query['hub.verify_token'];
    if (expected && supplied && safeEqual(supplied, expected)) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    return res.sendStatus(403);
  } catch (_) { return res.sendStatus(403); }
});

// Meta usa token global neste endpoint de bootstrap. Depois disso, POST e
// validado com o App Secret especifico do tenant, resolvido pela mensagem.
router.get('/whatsapp/:provider', (req, res) => {
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;
  if (req.params.provider === 'meta' && req.query['hub.mode'] === 'subscribe'
    && verifyToken && req.query['hub.verify_token'] === verifyToken) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
});

module.exports = router;
