DROP INDEX IF EXISTS uq_fiscal_dps_identity;

ALTER TABLE fiscal_documents
  DROP COLUMN IF EXISTS dps_number,
  DROP COLUMN IF EXISTS dps_series;

ALTER TABLE automation_settings
  DROP COLUMN IF EXISTS last_dps_number;

