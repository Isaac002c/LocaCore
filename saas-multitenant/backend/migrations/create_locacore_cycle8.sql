-- Ciclo 8 — modelo DOCX editável de contrato por tenant.
ALTER TABLE tenant_contract_settings
  ADD COLUMN IF NOT EXISTS docx_template BYTEA,
  ADD COLUMN IF NOT EXISTS docx_template_name VARCHAR(500),
  ADD COLUMN IF NOT EXISTS docx_template_size BIGINT,
  ADD COLUMN IF NOT EXISTS docx_template_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS docx_template_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS docx_template_updated_at TIMESTAMPTZ;

