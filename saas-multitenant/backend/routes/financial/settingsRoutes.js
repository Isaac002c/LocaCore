const express = require('express');
const router = express.Router();
const model = require('../../models/tenantFinancialSettingsModels');
const tenantModel = require('../../models/tenantModels');
const { requireFinanceRead, requireFinanceManage } = require('../../middlewares/financeAccess');
const { resolveBranding } = require('../../services/finance/branding');
const { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } = require('../../services/finance/constants');

// GET /api/financial/settings — configurações financeiras do tenant
router.get('/', requireFinanceRead, async (req, res) => {
  try {
    const settings = await model.ensureSettings(req.tenantId);
    const [tenant, maxNumber] = await Promise.all([
      tenantModel.getTenantById(req.tenantId),
      model.getMaxReceiptNumber(req.tenantId),
    ]);
    const branding = resolveBranding({ tenant, settings });
    res.json({
      success: true,
      data: {
        ...settings,
        next_receipt_number: settings.last_receipt_number + 1,
        max_receipt_number: maxNumber,
        branding,
        payment_methods: PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
      },
    });
  } catch (err) {
    console.error('[finance] obter configurações:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao obter configurações' });
  }
});

// PUT /api/financial/settings — atualizar (admin)
router.put('/', requireFinanceManage, async (req, res) => {
  try {
    const b = req.body;
    // Prefixo: letras/números apenas
    if (b.receipt_prefix && !/^[A-Za-z0-9]{1,20}$/.test(b.receipt_prefix)) {
      return res.status(400).json({ success: false, error: 'Prefixo deve conter apenas letras e números (até 20)' });
    }

    // Próximo número não pode gerar conflito com recibos existentes.
    let last_receipt_number;
    if (b.next_receipt_number !== undefined && b.next_receipt_number !== null && b.next_receipt_number !== '') {
      const next = parseInt(b.next_receipt_number, 10);
      if (!Number.isInteger(next) || next < 1) {
        return res.status(400).json({ success: false, error: 'Próximo número inválido' });
      }
      const max = await model.getMaxReceiptNumber(req.tenantId);
      if (next <= max) {
        return res.status(400).json({ success: false, error: `Próximo número deve ser maior que ${max} (já existem recibos até esse número)` });
      }
      last_receipt_number = next - 1;
    }

    if (b.enabled_payment_methods && !Array.isArray(b.enabled_payment_methods)) {
      return res.status(400).json({ success: false, error: 'Formas de pagamento inválidas' });
    }

    await model.ensureSettings(req.tenantId);
    const data = await model.updateSettings(req.tenantId, {
      receipt_prefix: b.receipt_prefix,
      last_receipt_number,
      razao_social: b.razao_social,
      document: b.document,
      address: b.address,
      phone: b.phone,
      email: b.email,
      logo_url: b.logo_url,
      enabled_payment_methods: b.enabled_payment_methods,
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[finance] atualizar configurações:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao atualizar configurações' });
  }
});

module.exports = router;
