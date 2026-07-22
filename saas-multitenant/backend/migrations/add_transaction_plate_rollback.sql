-- Rollback de add_transaction_plate.sql (não executar em produção sem necessidade).
DROP INDEX IF EXISTS idx_fin_tx_plate;
ALTER TABLE financial_transactions DROP COLUMN IF EXISTS plate;
