-- =============================================================================
-- Migration: LocaCore — Ciclo 3 (Automação: cobrança semanal, WhatsApp, fiscal)
-- -----------------------------------------------------------------------------
-- PURAMENTE ADITIVA e idempotente. Aplicar DEPOIS de create_locacore_cycle2.sql.
--
--   psql "$DATABASE_URL" -f migrations/create_locacore_cycle3.sql
--
-- Secrets (tokens/credenciais/certificado) NÃO são persistidos aqui — vêm de
-- variáveis de ambiente/secret manager. As tabelas guardam só seleção de provedor,
-- identificadores externos e estado. Dinheiro em NUMERIC; enums via VARCHAR+CHECK.
-- Idempotência por chaves únicas (idempotency_key). Rollback: _cycle3_rollback.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) automation_settings — configuração de automação por tenant ────────────
CREATE TABLE IF NOT EXISTS automation_settings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- Cobrança semanal
  billing_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  billing_weekday          INTEGER NOT NULL DEFAULT 3,     -- 0=dom .. 6=sáb (3=quarta)
  billing_hour             INTEGER NOT NULL DEFAULT 9,
  billing_timezone         VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
  billing_due_days         INTEGER NOT NULL DEFAULT 3,
  billing_rental_statuses  JSONB   NOT NULL DEFAULT '["em_andamento","atrasado"]'::jsonb,
  billing_auto_create      BOOLEAN NOT NULL DEFAULT TRUE,  -- cria cobrança vs. só cria tarefa
  -- WhatsApp
  whatsapp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_provider        VARCHAR(30) NOT NULL DEFAULT 'null',   -- 'null'|'meta'|'twilio'|...
  whatsapp_from            VARCHAR(30),
  whatsapp_account_id      VARCHAR(120),
  whatsapp_send_start_hour INTEGER NOT NULL DEFAULT 8,
  whatsapp_send_end_hour   INTEGER NOT NULL DEFAULT 20,
  reminder_max             INTEGER NOT NULL DEFAULT 7,
  reminder_interval_hours  INTEGER NOT NULL DEFAULT 24,
  reminder_per_day         INTEGER NOT NULL DEFAULT 1,
  -- Pagamento (geração de cobrança/PIX)
  payment_provider         VARCHAR(30) NOT NULL DEFAULT 'null',
  -- Fiscal (NUNCA assume NF-e/NFS-e — tipo é parametrizado e validado pela empresa)
  fiscal_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  fiscal_mode              VARCHAR(20) NOT NULL DEFAULT 'after_payment'
                           CHECK (fiscal_mode IN ('after_payment','weekly_batch','manual')),
  fiscal_provider          VARCHAR(30) NOT NULL DEFAULT 'null',
  fiscal_document_type     VARCHAR(20),                    -- 'nfe'|'nfse'|... definido pela empresa
  fiscal_environment       VARCHAR(20) NOT NULL DEFAULT 'homologacao'
                           CHECK (fiscal_environment IN ('homologacao','producao')),
  fiscal_config            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- município, cnpj, im, regime, serviço, discriminação...
  -- Custos externos
  cost_per_message         NUMERIC(15,4) NOT NULL DEFAULT 0,
  cost_per_fiscal          NUMERIC(15,4) NOT NULL DEFAULT 0,
  cost_currency            VARCHAR(8) NOT NULL DEFAULT 'BRL',
  cost_monthly_limit       NUMERIC(15,2),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2) message_templates — modelos de mensagem por tenant ────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind                VARCHAR(30) NOT NULL,              -- billing|reminder|payment_confirmed|custom
  name                VARCHAR(120),
  language            VARCHAR(10) NOT NULL DEFAULT 'pt_BR',
  body                TEXT NOT NULL,
  variables           JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_template_id VARCHAR(120),
  approval_status     VARCHAR(20) NOT NULL DEFAULT 'approved',
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_templates_tenant ON message_templates(tenant_id, kind, active);

-- ── 3) charges — cobrança (PIX/link) vinculada a faturamento/locação ─────────
CREATE TABLE IF NOT EXISTS charges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id       UUID REFERENCES rentals(id) ON DELETE SET NULL,
  billing_id      UUID REFERENCES service_billings(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  provider        VARCHAR(30) NOT NULL DEFAULT 'null',
  external_id     VARCHAR(160),
  amount          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  due_date        DATE,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','expired','canceled')),
  pix_code        TEXT,
  payment_link    TEXT,
  expires_at      TIMESTAMPTZ,
  period_start    DATE,
  period_end      DATE,
  idempotency_key VARCHAR(200) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_charges_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_charges_tenant   ON charges(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_charges_rental   ON charges(tenant_id, rental_id);
CREATE INDEX IF NOT EXISTS idx_charges_external ON charges(provider, external_id);

-- ── 4) message_outbox — fila de mensagens (WhatsApp) com retry/status ────────
CREATE TABLE IF NOT EXISTS message_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  rental_id       UUID REFERENCES rentals(id) ON DELETE SET NULL,
  charge_id       UUID REFERENCES charges(id) ON DELETE SET NULL,
  template_kind   VARCHAR(30) NOT NULL,             -- billing|reminder|payment_confirmed
  to_number       VARCHAR(30),
  body            TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','queued','processing','sent','delivered','read','failed','canceled','skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ,
  provider        VARCHAR(30),
  external_id     VARCHAR(160),
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  error           TEXT,
  cost_amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(200) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_outbox_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_outbox_tenant   ON message_outbox(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_pending  ON message_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_external ON message_outbox(provider, external_id);
CREATE INDEX IF NOT EXISTS idx_outbox_charge   ON message_outbox(tenant_id, charge_id);

-- ── 5) fiscal_documents — notas fiscais (tipo parametrizado) ─────────────────
CREATE TABLE IF NOT EXISTS fiscal_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id          UUID REFERENCES rentals(id) ON DELETE SET NULL,
  client_id          UUID REFERENCES clients(id) ON DELETE SET NULL,
  billing_id         UUID REFERENCES service_billings(id) ON DELETE SET NULL,
  payment_id         UUID REFERENCES payments(id) ON DELETE SET NULL,
  provider           VARCHAR(30) NOT NULL DEFAULT 'null',
  external_id        VARCHAR(160),
  document_type      VARCHAR(20),
  number             VARCHAR(40),
  series             VARCHAR(20),
  verification_code  VARCHAR(120),
  amount             NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status             VARCHAR(30) NOT NULL DEFAULT 'pending_configuration'
                     CHECK (status IN ('pending_configuration','pending','queued','processing',
                            'authorized','rejected','failed','canceled','cancellation_pending','skipped')),
  issue_date         TIMESTAMPTZ,
  authorization_date TIMESTAMPTZ,
  cancellation_date  TIMESTAMPTZ,
  pdf_url            TEXT,
  xml_url            TEXT,
  error_code         VARCHAR(60),
  error_message      TEXT,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  idempotency_key    VARCHAR(200) NOT NULL,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_fiscal_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_tenant   ON fiscal_documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fiscal_payment  ON fiscal_documents(tenant_id, payment_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_external ON fiscal_documents(provider, external_id);

-- ── 6) automation_runs — execuções do job (log + idempotência) ───────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_type           VARCHAR(20) NOT NULL,   -- billing|dunning|fiscal_batch|outbox
  period_start       DATE,
  period_end         DATE,
  status             VARCHAR(20) NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','completed','failed')),
  rentals_processed  INTEGER NOT NULL DEFAULT 0,
  charges_created    INTEGER NOT NULL DEFAULT 0,
  messages_enqueued  INTEGER NOT NULL DEFAULT 0,
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key    VARCHAR(200) NOT NULL,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  CONSTRAINT uq_runs_idem UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_runs_tenant ON automation_runs(tenant_id, run_type, started_at);

-- ── 7) external_costs — razão de consumo (WhatsApp/fiscal) por tenant ────────
CREATE TABLE IF NOT EXISTS external_costs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       VARCHAR(30) NOT NULL,           -- whatsapp_message|fiscal_document
  ref_id     UUID,
  provider   VARCHAR(30),
  quantity   INTEGER NOT NULL DEFAULT 1,
  unit_cost  NUMERIC(15,4) NOT NULL DEFAULT 0,
  amount     NUMERIC(15,4) NOT NULL DEFAULT 0,
  currency   VARCHAR(8) NOT NULL DEFAULT 'BRL',
  cost_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ext_costs_tenant ON external_costs(tenant_id, kind, cost_date);

-- ── 8) webhook_events — idempotência/anti-replay de webhooks externos ────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
  provider          VARCHAR(30) NOT NULL,
  kind              VARCHAR(30) NOT NULL,     -- whatsapp|payment|fiscal
  external_event_id VARCHAR(200) NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_event UNIQUE (provider, external_event_id)
);

-- =============================================================================
-- FIM — LocaCore Ciclo 3.
-- =============================================================================
