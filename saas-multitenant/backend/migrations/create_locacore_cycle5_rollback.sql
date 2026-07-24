-- =============================================================================
-- ROLLBACK: LocaCore — Ciclo 5. Reversível e idempotente. Backup antes.
-- Remove só o que o Ciclo 5 criou. Ciclos anteriores intactos.
-- =============================================================================
ALTER TABLE rentals DROP COLUMN IF EXISTS return_inspection;
ALTER TABLE rentals DROP COLUMN IF EXISTS pickup_inspection;

DROP INDEX IF EXISTS idx_calendar_rental;
ALTER TABLE calendar_events DROP COLUMN IF EXISTS priority;
ALTER TABLE calendar_events DROP COLUMN IF EXISTS maintenance_id;
ALTER TABLE calendar_events DROP COLUMN IF EXISTS vehicle_id;
ALTER TABLE calendar_events DROP COLUMN IF EXISTS rental_id;

ALTER TABLE users DROP COLUMN IF EXISTS sessions_valid_after;
-- NÃO derruba is_active: os modelos existentes dependem dela (pode preceder o Ciclo 5).

DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS storage_objects CASCADE;
DROP TABLE IF EXISTS tenant_contract_settings CASCADE;
DROP TABLE IF EXISTS rental_contracts CASCADE;
DROP TABLE IF EXISTS inventory_movements CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS rental_fines CASCADE;
-- =============================================================================
