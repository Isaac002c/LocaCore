const pool = require('../config/db');
const { DEFAULT_BRANDING, PAYMENT_METHODS } = require('../services/finance/constants');

// ============================================
// TENANT FINANCIAL SETTINGS MODEL (1 linha por tenant)
// ============================================

// Garante que exista a linha de configuração do tenant (idempotente).
const ensureSettings = async (tenant_id) => {
  if (!tenant_id) throw new Error('tenant_id é obrigatório');
  const { rows } = await pool.query(
    `INSERT INTO tenant_financial_settings (tenant_id, receipt_prefix)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = tenant_financial_settings.updated_at
     RETURNING *`,
    [tenant_id, DEFAULT_BRANDING.receipt_prefix]
  );
  return rows[0];
};

const getSettings = async (tenant_id) => {
  const { rows } = await pool.query(
    `SELECT * FROM tenant_financial_settings WHERE tenant_id = $1`,
    [tenant_id]
  );
  return rows[0];
};

// Maior número de recibo já emitido para o tenant (para validar next_number).
const getMaxReceiptNumber = async (tenant_id) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(number), 0)::int AS max FROM receipts WHERE tenant_id = $1`,
    [tenant_id]
  );
  return rows[0].max;
};

const updateSettings = async (tenant_id, data) => {
  const {
    receipt_prefix, last_receipt_number, razao_social, document,
    address, phone, email, logo_url, enabled_payment_methods,
  } = data;

  let methods = null;
  if (Array.isArray(enabled_payment_methods)) {
    methods = JSON.stringify(
      enabled_payment_methods.filter((m) => PAYMENT_METHODS.includes(m))
    );
  }

  const { rows } = await pool.query(
    `UPDATE tenant_financial_settings SET
        receipt_prefix          = COALESCE($1, receipt_prefix),
        last_receipt_number     = COALESCE($2, last_receipt_number),
        razao_social            = $3,
        document                = $4,
        address                 = $5,
        phone                   = $6,
        email                   = $7,
        logo_url                = $8,
        enabled_payment_methods = COALESCE($9::jsonb, enabled_payment_methods),
        updated_at              = NOW()
     WHERE tenant_id = $10 RETURNING *`,
    [
      receipt_prefix || null,
      last_receipt_number ?? null,
      razao_social ?? null,
      document ?? null,
      address ?? null,
      phone ?? null,
      email ?? null,
      logo_url ?? null,
      methods,
      tenant_id,
    ]
  );
  return rows[0];
};

module.exports = {
  ensureSettings,
  getSettings,
  getMaxReceiptNumber,
  updateSettings,
};
