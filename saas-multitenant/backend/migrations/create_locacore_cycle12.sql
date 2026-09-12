-- =============================================================================
-- LocaCore - Ciclo 12
-- Numeração persistente e idempotente da DPS para emissão direta na SEFIN.
-- =============================================================================

ALTER TABLE automation_settings
  ADD COLUMN IF NOT EXISTS last_dps_number BIGINT NOT NULL DEFAULT 0;

ALTER TABLE fiscal_documents
  ADD COLUMN IF NOT EXISTS dps_number BIGINT,
  ADD COLUMN IF NOT EXISTS dps_series VARCHAR(5);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_dps_identity
  ON fiscal_documents(tenant_id, dps_series, dps_number)
  WHERE dps_series IS NOT NULL AND dps_number IS NOT NULL;

