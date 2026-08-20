-- Rollback estrutural do Ciclo 9. Use somente com backup e janela de manutencao.
-- Falha de propósito se ainda existirem linhas com estados/modos exclusivos do
-- ciclo 9: converta-as conscientemente antes, para não perder semântica.
DROP TABLE IF EXISTS automation_audit_log;
DROP TABLE IF EXISTS fiscal_category_mappings;
DROP TABLE IF EXISTS tenant_fiscal_certificates;
DROP TABLE IF EXISTS tenant_integration_secrets;

DROP INDEX IF EXISTS idx_charges_transaction;
DROP INDEX IF EXISTS uq_charges_provider_public_id;

ALTER TABLE webhook_events
  DROP COLUMN IF EXISTS payload_hash,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS processing_status,
  DROP COLUMN IF EXISTS error_message;

ALTER TABLE fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_status_check;
ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_status_check CHECK (status IN (
  'pending_configuration','pending','queued','processing','authorized','rejected','failed',
  'canceled','cancellation_pending','skipped'
));
ALTER TABLE fiscal_documents
  DROP COLUMN IF EXISTS fiscal_category,
  DROP COLUMN IF EXISTS provider_payload,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS next_attempt_at;

ALTER TABLE message_outbox DROP CONSTRAINT IF EXISTS message_outbox_status_check;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_status_check CHECK (status IN (
  'pending','queued','processing','sent','delivered','read','failed','canceled','skipped'
));

ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_status_check;
ALTER TABLE charges ADD CONSTRAINT charges_status_check CHECK (status IN (
  'pending','paid','expired','canceled'
));
ALTER TABLE charges
  DROP COLUMN IF EXISTS public_id,
  DROP COLUMN IF EXISTS provider_metadata,
  DROP COLUMN IF EXISTS transaction_nsu,
  DROP COLUMN IF EXISTS receipt_url,
  DROP COLUMN IF EXISTS error_code,
  DROP COLUMN IF EXISTS error_message,
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS next_attempt_at,
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS correlation_id;

ALTER TABLE clients
  DROP COLUMN IF EXISTS address_zip,
  DROP COLUMN IF EXISTS address_street,
  DROP COLUMN IF EXISTS address_number,
  DROP COLUMN IF EXISTS address_complement,
  DROP COLUMN IF EXISTS address_neighborhood,
  DROP COLUMN IF EXISTS address_city,
  DROP COLUMN IF EXISTS address_state,
  DROP COLUMN IF EXISTS municipality_ibge;

ALTER TABLE vehicles
  DROP COLUMN IF EXISTS ncm,
  DROP COLUMN IF EXISTS fiscal_description;

ALTER TABLE rentals
  DROP CONSTRAINT IF EXISTS rentals_weekly_rate_check,
  DROP CONSTRAINT IF EXISTS rentals_billing_value_source_check,
  DROP CONSTRAINT IF EXISTS rentals_billing_frequency_check;
ALTER TABLE rentals
  DROP COLUMN IF EXISTS weekly_rate,
  DROP COLUMN IF EXISTS billing_value_source,
  DROP COLUMN IF EXISTS billing_frequency;

ALTER TABLE automation_settings DROP CONSTRAINT IF EXISTS automation_settings_automation_mode_check;
ALTER TABLE automation_settings DROP CONSTRAINT IF EXISTS automation_settings_fiscal_mode_check;
ALTER TABLE automation_settings ADD CONSTRAINT automation_settings_fiscal_mode_check
  CHECK (fiscal_mode IN ('after_payment','weekly_batch','manual'));
ALTER TABLE automation_settings
  DROP COLUMN IF EXISTS automation_mode,
  DROP COLUMN IF EXISTS pilot_rental_ids,
  DROP COLUMN IF EXISTS rollout_limit,
  DROP COLUMN IF EXISTS last_charge_number,
  DROP COLUMN IF EXISTS payment_config,
  DROP COLUMN IF EXISTS whatsapp_config,
  DROP COLUMN IF EXISTS last_dry_run_at,
  DROP COLUMN IF EXISTS pilot_validated_at;
