-- =============================================================================
-- NEXOS — Schema base versionado (reconstruído a partir do código).
-- Idempotente (CREATE ... IF NOT EXISTS). PostgreSQL puro (sem Supabase/auth,
-- sem RLS). Multi-tenant por tenant_id. Aplicar ANTES de create_financial_module.sql.
--
--   psql "$DATABASE_URL" -f migrations/000_nexos_schema.sql
--   psql "$DATABASE_URL" -f migrations/create_financial_module.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Tenants (empresas) ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(120) UNIQUE,
  status           VARCHAR(20) NOT NULL DEFAULT 'ativo',
  email            VARCHAR(255),
  logo_url         TEXT,
  brand_color      VARCHAR(20),
  brand_color_dark VARCHAR(20),
  tagline          VARCHAR(255),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Planos SaaS (assinatura) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  yearly_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_clients   INTEGER NOT NULL DEFAULT 0,
  max_contracts INTEGER NOT NULL DEFAULT 0,
  max_users     INTEGER NOT NULL DEFAULT 1,
  features      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id    UUID NOT NULL REFERENCES plans(id),
  status     VARCHAR(20) NOT NULL DEFAULT 'trial',
  end_date   TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_plans_tenant ON company_plans(tenant_id);

-- ── Usuários ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'seller',
  seller_id     UUID,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- E-mail único por tenant (colisão de e-mail entre tenants é permitida).
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_email ON users(tenant_id, LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ── Vendedores (equipe comercial) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sellers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  email          VARCHAR(255),
  avatar         TEXT,
  monthly_target NUMERIC(15,2) DEFAULT 0,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sellers_tenant ON sellers(tenant_id);

-- ── Tipos de serviço (catálogo global) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_types (
  id    SERIAL PRIMARY KEY,
  code  VARCHAR(60) NOT NULL,
  label VARCHAR(120) NOT NULL
);

-- ── Leads (multas_leads: funil de captação) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS multas_leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  cpf                VARCHAR(14),
  cnh                VARCHAR(20),
  first_license_date DATE,
  birth_date         DATE,
  phone              VARCHAR(20),
  source             VARCHAR(100),
  status             VARCHAR(30) NOT NULL DEFAULT 'entrada',
  motivo             TEXT,
  notes              TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_name    VARCHAR(255),
  stage_changed_at   TIMESTAMPTZ DEFAULT NOW(),
  archived_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT multas_leads_status_check CHECK (status IN
    ('entrada','possui_defensor','nao_quer_defender','negociacao','fechado','perdido','nao_encontrado'))
);
CREATE INDEX IF NOT EXISTS idx_multas_leads_tenant   ON multas_leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_multas_leads_stage    ON multas_leads(tenant_id, status, stage_changed_at);
CREATE INDEX IF NOT EXISTS idx_multas_leads_archived ON multas_leads(archived_at) WHERE archived_at IS NULL;

-- ── Clientes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  cpf        VARCHAR(14),
  cnh        VARCHAR(20),
  first_cnh  DATE,
  birth_date DATE,
  phone      VARCHAR(20),
  email      VARCHAR(255),
  address    TEXT,
  notes      TEXT,
  status     VARCHAR(50) NOT NULL DEFAULT 'negociacao',
  lead_id    UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clients_status_check CHECK (status IN ('negociacao','fechado'))
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant        ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_status ON clients(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_clients_cpf           ON clients(tenant_id, cpf);
CREATE INDEX IF NOT EXISTS idx_clients_lead_id       ON clients(lead_id) WHERE lead_id IS NOT NULL;

-- ── Empresas (PJ) ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  razao_social  TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj          VARCHAR(14) NOT NULL,
  responsavel   TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'ativo',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_tenant_cnpj ON companies(tenant_id, cnpj);

-- ── Veículos das empresas (frota) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_vehicles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plate          TEXT,
  brand          TEXT,
  model          TEXT,
  year           INTEGER,
  renavam        TEXT,
  owner_document VARCHAR(14),
  driver_name    VARCHAR(255),
  driver_cpf     VARCHAR(11),
  driver_cnh     VARCHAR(20),
  notes          TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'ativo',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_vehicles_tenant  ON company_vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_vehicles_company ON company_vehicles(company_id);

-- ── Processos (fines) — entidade operacional central ─────────────────────────
CREATE TABLE IF NOT EXISTS fines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  company_id        UUID REFERENCES companies(id) ON DELETE SET NULL,
  vehicle_id        UUID REFERENCES company_vehicles(id) ON DELETE SET NULL,
  service_type_id   INTEGER REFERENCES service_types(id),
  seller_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  fine_number       VARCHAR(100),
  plate             VARCHAR(20),
  organ             VARCHAR(120),
  infraction_type   VARCHAR(120),
  vehicle_model     VARCHAR(120),
  infraction_date   DATE,
  due_date          DATE,
  defense_date      DATE,
  stage             VARCHAR(60) NOT NULL DEFAULT 'cadastro',
  status            VARCHAR(40) NOT NULL DEFAULT 'pendente',
  value             NUMERIC(15,2) NOT NULL DEFAULT 0,
  cost              NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_value        NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  protocol_number   VARCHAR(100),
  protocol_date     DATE,
  protocol_status   VARCHAR(50),
  protocol_notes    TEXT,
  protocol_file_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fines_tenant       ON fines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fines_client_id    ON fines(client_id);
CREATE INDEX IF NOT EXISTS idx_fines_company      ON fines(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_fines_vehicle      ON fines(tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fines_tenant_stage ON fines(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_fines_tenant_due   ON fines(tenant_id, due_date);

-- ── Protocolos dos processos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_protocols (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fine_id           UUID NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
  protocol_number   VARCHAR(100),
  protocol_date     DATE,
  protocol_status   VARCHAR(50) DEFAULT 'protocolado',
  protocol_notes    TEXT,
  protocol_file_url TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fine_protocols_fine   ON fine_protocols(fine_id);
CREATE INDEX IF NOT EXISTS idx_fine_protocols_tenant ON fine_protocols(tenant_id);

-- ── Documentos dos processos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fine_id     UUID NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  file_url    TEXT NOT NULL,
  file_type   VARCHAR(100),
  file_size   BIGINT,
  category    VARCHAR(100) DEFAULT 'outro',
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fine_documents_fine   ON fine_documents(fine_id);
CREATE INDEX IF NOT EXISTS idx_fine_documents_tenant ON fine_documents(tenant_id);

-- ── Histórico dos processos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fine_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fine_id    UUID NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
  action     VARCHAR(60) NOT NULL,
  field_name VARCHAR(120),
  old_value  TEXT,
  new_value  TEXT,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fine_logs_fine   ON fine_logs(fine_id);
CREATE INDEX IF NOT EXISTS idx_fine_logs_tenant ON fine_logs(tenant_id);

-- ── Documentos do cliente/empresa/veículo ────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id UUID,
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  vehicle_id  UUID REFERENCES company_vehicles(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  file_name   VARCHAR(500),
  file_type   VARCHAR(100),
  file_size   BIGINT,
  category    VARCHAR(100) DEFAULT 'outros',
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_tenant  ON documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_client  ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_documents_vehicle ON documents(tenant_id, vehicle_id);

-- ── Agenda / eventos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  event_date          DATE NOT NULL,
  start_time          TIME,
  end_time            TIME,
  type                VARCHAR(30) NOT NULL DEFAULT 'outro',
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,
  fine_id             UUID REFERENCES fines(id)   ON DELETE SET NULL,
  service_type_id     INTEGER REFERENCES service_types(id),
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'agendado',
  value               NUMERIC(12,2),
  payment_method      VARCHAR(60),
  attendee_cpf        VARCHAR(11),
  attendee_cnh        VARCHAR(20),
  attendee_first_cnh  DATE,
  attendee_birth_date DATE,
  attendee_phone      VARCHAR(20),
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_tenant_date ON calendar_events(tenant_id, event_date);

-- ── Solicitações de aprovação (exclusões pedidas por consultor) ──────────────
CREATE TABLE IF NOT EXISTS approval_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type  VARCHAR(50) NOT NULL,
  target_id    UUID NOT NULL,
  target_label VARCHAR(255),
  reason       TEXT,
  status       VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);

-- ── Logs de atividade (auditoria) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  entity      VARCHAR(60),
  entity_id   UUID,
  entity_name TEXT,
  action      VARCHAR(60),
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_tenant      ON activity_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_name ON activity_logs(entity_name) WHERE entity_name IS NOT NULL;

-- ── Módulo de Leads (pipeline comercial genérico) ────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255),
  phone       VARCHAR(50),
  company     VARCHAR(255),
  value       NUMERIC(15,2) DEFAULT 0,
  status      VARCHAR(50) DEFAULT 'novo',
  stage       VARCHAR(50) DEFAULT 'lead',
  source      VARCHAR(100),
  notes       TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant   ON leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);

CREATE TABLE IF NOT EXISTS company_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month        INTEGER NOT NULL,
  year         INTEGER NOT NULL,
  target_value NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, month, year)
);
CREATE INDEX IF NOT EXISTS idx_company_targets_tenant ON company_targets(tenant_id);

CREATE TABLE IF NOT EXISTS lead_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type         VARCHAR(50) NOT NULL,
  description  TEXT,
  due_date     TIMESTAMPTZ,
  completed    BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead   ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_tenant ON lead_activities(tenant_id);

-- =============================================================================
-- SEED mínimo indispensável
-- =============================================================================

-- Tipos de serviço (ids fixos p/ casar com o frontend). Idempotente.
INSERT INTO service_types (id, code, label) VALUES
  (1, 'CRCI',            'CRCI'),
  (2, 'MULTA',           'Auto de Infração'),
  (3, 'SUSPENSAO',       'Suspensão'),
  (4, 'CASSACAO',        'Cassação'),
  (5, 'REVISAO DE ATOS', 'Revisão de Atos'),
  (6, 'TRI',             'Troca de Real Infrator'),
  (7, 'OUTROS',          'Outros')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('service_types','id'), GREATEST((SELECT MAX(id) FROM service_types), 1));

-- Plano inicial "Free" (ilimitado). Idempotente por nome.
INSERT INTO plans (name, monthly_price, yearly_price, max_clients, max_contracts, max_users, features, is_active)
SELECT 'Free', 0, 0, 0, 0, 0, '{}'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE LOWER(name) = 'free');

-- =============================================================================
-- FIM do schema base do Nexos.
-- =============================================================================
