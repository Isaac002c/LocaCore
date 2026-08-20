'use strict';

// =============================================================================
// publicDocumentRoutes.js — Entrega pública de documentos do cliente (§8/§39).
//
// Montado SEM autenticação de sessão: o acesso é autorizado por um token HMAC
// na URL (publicLinks). Sem token válido → 403. O documento é streamado como PDF
// (mesmo motor do recibo autenticado). Rate-limitado e sem enumeração.
// =============================================================================

const express = require('express');
const rateLimit = require('express-rate-limit');
const publicLinks = require('../services/automation/publicLinks');
const receiptModel = require('../models/receiptModels');
const tenantModel = require('../models/tenantModels');
const settingsModel = require('../models/tenantFinancialSettingsModels');
const { resolveBranding } = require('../services/finance/branding');
const { buildReceiptPdf } = require('../services/finance/pdfService');

const router = express.Router();
router.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

// GET /public/documents/receipt/:id?tid=<tenant>&t=<token>
router.get('/documents/receipt/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tenant_id = String(req.query.tid || '');
    const token = String(req.query.t || '');
    if (!tenant_id || !publicLinks.verify('receipt', tenant_id, id, token)) return res.sendStatus(403);

    const receipt = await receiptModel.getReceiptById(id, tenant_id);
    if (!receipt) return res.sendStatus(404);
    if (receipt.status === 'cancelado') return res.status(410).send('Documento cancelado.');

    const [settings, tenant] = await Promise.all([
      settingsModel.getSettings(tenant_id),
      tenantModel.getTenantById(tenant_id),
    ]);
    const branding = resolveBranding({ tenant, settings, receipt });
    let pdf;
    try {
      pdf = await buildReceiptPdf(receipt, branding);
    } catch (e) {
      if (e && (e.code === 'MODULE_NOT_FOUND' || /pdfkit/i.test(e.message))) return res.sendStatus(503);
      throw e;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="recibo-${receipt.full_number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(pdf);
  } catch (_) {
    res.sendStatus(500);
  }
});

module.exports = router;
