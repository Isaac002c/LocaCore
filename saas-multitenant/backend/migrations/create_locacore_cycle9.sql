-- =============================================================================
-- LocaCore - Ciclo 9
-- Automacao segura: InfinitePay, Evolution, fiscal nacional, readiness e piloto.
--
-- Migration puramente aditiva, salvo pela ampliacao de CHECK constraints para
-- aceitar os novos estados. Nenhum dado operacional existente e reescrito.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Configuracao e rollout por tenant.
ALTER TABLE automation_settings
  ADD COLUMN IF NOT EXISTS automation_mode VARCHAR(20) NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS pilot_rental_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rollout_limit INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_charge_number BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_dry_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pilot_validated_at TIMESTAMPTZ;

ALTER TABLE automation_settings DROP CONSTRAINT IF EXISTS automation_settings_automation_mode_check;
ALTER TABLE automation_settings ADD CONSTRAINT automation_settings_automation_mode_check
  CHECK (automation_mode IN ('off','dry_run','pilot','staged','global'));

ALTER TABLE automation_settings DROP CONSTRAINT IF EXISTS automation_settings_fiscal_mode_check;
ALTER TABLE automation_settings ADD CONSTRAINT automation_settings_fiscal_mode_check
  CHECK (fiscal_mode IN ('on_charge','on_due_date','after_payment','weekly_batch','manual'));

-- Valor contratual de cobranca. NULL significa "nao informado" e nunca e
-- preenchido automaticamente pela migration.
ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS weekly_rate NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS billing_value_source VARCHAR(20) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS billing_frequency VARCHAR(20) NOT NULL DEFAULT 'weekly';

ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_weekly_rate_check;
ALTER TABLE rentals ADD CONSTRAINT rentals_weekly_rate_check
  CHECK (weekly_rate IS NULL OR weekly_rate >= 0);
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_billing_value_source_check;
ALTER TABLE rentals ADD CONSTRAINT rentals_billing_value_source_check
  CHECK (billing_value_source IN ('auto','weekly','daily','total'));
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_billing_frequency_check;
ALTER TABLE rentals ADD CONSTRAINT rentals_billing_frequency_check
  CHECK (billing_frequency IN ('weekly','daily','one_time','manual'));

-- Classificacao fiscal mestre do bem.
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS ncm VARCHAR(8),
  ADD COLUMN IF NOT EXISTS fiscal_description VARCHAR(180);

-- Endereco fiscal estruturado do tomador, preservando o campo address legado.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS address_zip VARCHAR(9),
  ADD COLUMN IF NOT EXISTS address_street VARCHAR(180),
  ADD COLUMN IF NOT EXISTS address_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS address_complement VARCHAR(120),
  ADD COLUMN IF NOT EXISTS address_neighborhood VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address_state VARCHAR(2),
  ADD COLUMN IF NOT EXISTS municipality_ibge VARCHAR(7);

-- Estados fail-closed e metadados de conciliacao.
ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS public_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS transaction_nsu VARCHAR(180),
  ADD COLUMN IF NOT EXISTS receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correlation_id UUID;

ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_status_check;
ALTER TABLE charges ADD CONSTRAINT charges_status_check CHECK (status IN (
  'draft','processing','waiting_payment','paid','overdue','failed','cancelled','needs_attention',
  'pending','expired','canceled'
));

CREATE UNIQUE INDEX IF NOT EXISTS uq_charges_provider_public_id
  ON charges(provider, public_id) WHERE public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charges_transaction
  ON charges(provider, transaction_nsu) WHERE transaction_nsu IS NOT NULL;

ALTER TABLE message_outbox DROP CONSTRAINT IF EXISTS message_outbox_status_check;
ALTER TABLE message_outbox ADD CONSTRAINT message_outbox_status_check CHECK (status IN (
  'pending','queued','processing','sent','delivered','read','failed','canceled','skipped',
  'dead','manual','needs_attention'
));

ALTER TABLE fiscal_documents
  ADD COLUMN IF NOT EXISTS fiscal_category VARCHAR(40),
  ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS correlation_id UUID,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

ALTER TABLE fiscal_documents DROP CONSTRAINT IF EXISTS fiscal_documents_status_check;
ALTER TABLE fiscal_documents ADD CONSTRAINT fiscal_documents_status_check CHECK (status IN (
  'pending_configuration','pending','queued','processing','authorized','rejected','failed',
  'error','canceled','cancellation_pending','skipped','needs_attention'
));

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS payload_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS correlation_id UUID,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(30) NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Secrets por tenant, sempre cifrados com AES-256-GCM pela aplicacao.
CREATE TABLE IF NOT EXISTS tenant_integration_secrets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope       VARCHAR(40) NOT NULL,
  secret_name VARCHAR(80) NOT NULL,
  ciphertext  BYTEA NOT NULL,
  iv          BYTEA NOT NULL,
  auth_tag    BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_integration_secret UNIQUE (tenant_id, scope, secret_name)
);

-- Certificado A1 cifrado. Nunca e devolvido ao navegador depois do upload.
CREATE TABLE IF NOT EXISTS tenant_fiscal_certificates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  filename           VARCHAR(500) NOT NULL,
  mime_type          VARCHAR(120),
  size_bytes         BIGINT NOT NULL,
  sha256             VARCHAR(64) NOT NULL,
  encrypted_data     BYTEA NOT NULL,
  data_iv            BYTEA NOT NULL,
  data_auth_tag      BYTEA NOT NULL,
  encrypted_password BYTEA NOT NULL,
  password_iv        BYTEA NOT NULL,
  password_auth_tag  BYTEA NOT NULL,
  valid_from         TIMESTAMPTZ,
  valid_until        TIMESTAMPTZ,
  subject_name       TEXT,
  serial_number      VARCHAR(180),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tratamentos separados de locacao, multa, juros, caucao e adicionais.
CREATE TABLE IF NOT EXISTS fiscal_category_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_key          VARCHAR(60) NOT NULL,
  label                 VARCHAR(120) NOT NULL,
  national_tax_code     VARCHAR(20),
  municipal_service_code VARCHAR(40),
  nbs_code              VARCHAR(20),
  cst_ibs_cbs           VARCHAR(10),
  tax_classification    VARCHAR(20),
  iss_treatment         VARCHAR(30),
  config                JSONB NOT NULL DEFAULT '{}'::jsonb,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fiscal_category_mapping UNIQUE (tenant_id, category_key)
);

-- Trilha operacional detalhada, sem payloads secretos.
CREATE TABLE IF NOT EXISTS automation_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type     VARCHAR(60) NOT NULL,
  status         VARCHAR(30) NOT NULL,
  client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
  rental_id      UUID REFERENCES rentals(id) ON DELETE SET NULL,
  charge_id      UUID REFERENCES charges(id) ON DELETE SET NULL,
  billing_id     UUID REFERENCES service_billings(id) ON DELETE SET NULL,
  payment_id     UUID REFERENCES payments(id) ON DELETE SET NULL,
  fiscal_document_id UUID REFERENCES fiscal_documents(id) ON DELETE SET NULL,
  amount         NUMERIC(15,2),
  period_start   DATE,
  period_end     DATE,
  provider       VARCHAR(40),
  request_id     VARCHAR(180),
  correlation_id UUID,
  attempt        INTEGER NOT NULL DEFAULT 0,
  error_code     VARCHAR(80),
  error_message  TEXT,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_audit_tenant
  ON automation_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_audit_charge
  ON automation_audit_log(tenant_id, charge_id, created_at DESC);
