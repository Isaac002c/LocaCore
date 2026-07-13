// =============================================================================
// financialRoutes.js — Composição do módulo Financeiro sob /api/financial.
//
// Todas as sub-rotas já aplicam os guards de permissão (requireFinanceRead/
// requireFinanceManage). O tenantContext (montado em /api) garante autenticação
// e injeta req.tenantId. O tenant vem SEMPRE do token — payload.tenant_id é
// ignorado por todos os handlers.
// =============================================================================

const express = require('express');
const router = express.Router();

router.use('/categories',   require('./financial/categoryRoutes'));
router.use('/transactions', require('./financial/transactionRoutes'));
router.use('/cashbox',      require('./financial/cashboxRoutes'));
router.use('/billings',     require('./financial/billingRoutes'));
router.use('/payments',     require('./financial/paymentRoutes'));
router.use('/receipts',     require('./financial/receiptRoutes'));
router.use('/settings',     require('./financial/settingsRoutes'));
router.use('/summary',      require('./financial/summaryRoutes'));

module.exports = router;
