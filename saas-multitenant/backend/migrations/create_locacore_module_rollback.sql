-- =============================================================================
-- ROLLBACK: Módulo LocaCore (Frota + Locações)
-- -----------------------------------------------------------------------------
-- Desfaz create_locacore_module.sql. Reversível e idempotente.
--
-- ATENÇÃO: remove as tabelas de FROTA e LOCAÇÕES e seus dados. Faça backup antes.
-- Não toca em nenhuma tabela do domínio de despachante nem do financeiro além de
-- remover as COLUNAS de vínculo (rental_id / vehicle_asset_id) que este módulo
-- adicionou — as demais colunas e dados financeiros permanecem intactos.
-- =============================================================================

-- 1. Remove as colunas de vínculo adicionadas (condicional; preserva o resto).
DO $$
BEGIN
  IF to_regclass('public.service_billings') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_billings_rental;
    ALTER TABLE service_billings DROP COLUMN IF EXISTS rental_id;
  END IF;
  IF to_regclass('public.payments') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_payments_rental;
    ALTER TABLE payments DROP COLUMN IF EXISTS rental_id;
  END IF;
  IF to_regclass('public.financial_transactions') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_fin_tx_rental;
    ALTER TABLE financial_transactions DROP COLUMN IF EXISTS rental_id;
  END IF;
  IF to_regclass('public.receipts') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_receipts_rental;
    ALTER TABLE receipts DROP COLUMN IF EXISTS rental_id;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    DROP INDEX IF EXISTS idx_documents_rental;
    DROP INDEX IF EXISTS idx_documents_vehicle_asset;
    ALTER TABLE documents DROP COLUMN IF EXISTS rental_id;
    ALTER TABLE documents DROP COLUMN IF EXISTS vehicle_asset_id;
  END IF;
END $$;

-- 2. Remove as tabelas operacionais do LocaCore (rentals depende de vehicles).
DROP TABLE IF EXISTS rentals CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;

-- =============================================================================
-- FIM do rollback do módulo LocaCore.
-- =============================================================================
