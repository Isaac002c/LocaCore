-- Rollback do Ciclo 10 (LocaCore). Remove apenas o que o ciclo 10 adicionou.
-- Nao remove receipts.rental_id se ele foi criado por outro modulo antes.
ALTER TABLE automation_settings
  DROP COLUMN IF EXISTS payments_enabled,
  DROP COLUMN IF EXISTS receipts_enabled,
  DROP COLUMN IF EXISTS nfse_enabled,
  DROP COLUMN IF EXISTS nfse_mandatory_from,
  DROP COLUMN IF EXISTS document_auto_send;

DROP INDEX IF EXISTS idx_receipts_rental;
DROP INDEX IF EXISTS idx_receipts_payment;
