-- =============================================================================
-- ROLLBACK: Módulo Financeiro (MVP) — NEXO Despachantes CRM by ChronosTek
-- -----------------------------------------------------------------------------
-- Remove APENAS as tabelas criadas por create_financial_module.sql.
-- Não toca em nenhuma tabela pré-existente do sistema.
--
-- ATENÇÃO: DESTRUTIVO. Apaga todos os dados financeiros (categorias,
-- faturamentos, pagamentos, lançamentos, recibos e configurações).
-- Execute somente em rollback consciente e com backup confirmado.
--
-- A ordem respeita as dependências de FK (filhas antes das mães).
-- =============================================================================

DROP TABLE IF EXISTS financial_transactions CASCADE;
DROP TABLE IF EXISTS receipts               CASCADE;
DROP TABLE IF EXISTS payments               CASCADE;
DROP TABLE IF EXISTS service_billings       CASCADE;
DROP TABLE IF EXISTS financial_categories   CASCADE;
DROP TABLE IF EXISTS tenant_financial_settings CASCADE;

-- =============================================================================
-- FIM — Módulo Financeiro removido.
-- =============================================================================
