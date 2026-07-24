-- =============================================================================
-- Migration: LocaCore — Ciclo 5 (Multas, Estoque, Calendário, Contratos, Storage, Usuários)
-- -----------------------------------------------------------------------------
-- PURAMENTE ADITIVA e idempotente. Aplicar DEPOIS de create_locacore_cycle4.sql.
--   psql "$DATABASE_URL" -f migrations/create_locacore_cycle5.sql
-- Dinheiro em NUMERIC; tenant_id em tudo; enums via VARCHAR+CHECK.
-- Rollback: create_locacore_cycle5_rollback.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) rental_fines — MULTAS da locadora (contexto próprio, ≠ despachante) ────
CREATE TABLE IF NOT EXISTS rental_fines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id           UUID REFERENCES rentals(id)  ON DELETE SET NULL,
  vehicle_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  client_id           UUID REFERENCES clients(id)  ON DELETE SET NULL,
  driver_name         VARCHAR(160),
  fine_number         VARCHAR(100),
  organ               VARCHAR(120),
  infraction_date     DATE,
  notification_date   DATE,
  due_date            DATE,
  original_amount     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (original_amount >= 0),
  admin_fee           NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (admin_fee >= 0),
  total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  points              INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  notes               TEXT,
  status              VARCHAR(40) NOT NULL DEFAULT 'identificada'
                      CHECK (status IN ('identificada','aguardando_validacao','aguardando_condutor',
                             'comunicada','aguardando_pagamento','cobrada','paga','recorrida','cancelada','encerrada')),
  responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  billing_id          UUID REFERENCES service_billings(id) ON DELETE SET NULL, -- vínculo financeiro (§4)
  rental_extra_id     UUID,                                                    -- se virou adicional
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_fines_tenant  ON rental_fines(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rental_fines_rental  ON rental_fines(tenant_id, rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_fines_vehicle ON rental_fines(tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rental_fines_client  ON rental_fines(tenant_id, client_id);

-- ── 2) inventory_items — itens de ESTOQUE ────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         VARCHAR(160) NOT NULL,
  code         VARCHAR(60),
  category     VARCHAR(80),
  unit         VARCHAR(20) NOT NULL DEFAULT 'un',
  description  TEXT,
  quantity     NUMERIC(15,3) NOT NULL DEFAULT 0,
  min_quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_cost    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  location     VARCHAR(120),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_items_tenant ON inventory_items(tenant_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_items_code ON inventory_items(tenant_id, LOWER(code)) WHERE code IS NOT NULL AND code <> '';

-- ── 3) inventory_movements — movimentações de estoque ────────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type           VARCHAR(20) NOT NULL
                 CHECK (type IN ('entrada','saida','ajuste_pos','ajuste_neg','devolucao','consumo','perda')),
  quantity       NUMERIC(15,3) NOT NULL CHECK (quantity > 0),
  unit_cost      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  balance_after  NUMERIC(15,3) NOT NULL DEFAULT 0,   -- saldo do item após a movimentação
  reason         TEXT,
  movement_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_id     UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  rental_id      UUID REFERENCES rentals(id)  ON DELETE SET NULL,
  maintenance_id UUID REFERENCES vehicle_maintenances(id) ON DELETE SET NULL,
  supplier       VARCHAR(160),
  notes          TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant ON inventory_movements(tenant_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_inv_mov_item   ON inventory_movements(tenant_id, item_id, created_at);

-- ── 4) rental_contracts — versões do contrato de locação (§7) ────────────────
CREATE TABLE IF NOT EXISTS rental_contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_id   UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  number      VARCHAR(40),
  snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- dados congelados na geração
  status      VARCHAR(20) NOT NULL DEFAULT 'gerado' CHECK (status IN ('gerado','cancelado')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_contracts ON rental_contracts(tenant_id, rental_id, version);

-- ── 5) tenant_contract_settings — cabeçalho/cláusulas/rodapé configuráveis ───
CREATE TABLE IF NOT EXISTS tenant_contract_settings (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  header      TEXT,
  clauses     TEXT,
  footer      TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6) storage_objects — metadados do armazenamento (nunca secrets) ──────────
CREATE TABLE IF NOT EXISTS storage_objects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     VARCHAR(30) NOT NULL DEFAULT 'local',
  bucket       VARCHAR(120),
  object_key   TEXT NOT NULL,
  category     VARCHAR(60),
  entity_type  VARCHAR(40),
  entity_id    UUID,
  file_name    VARCHAR(500),
  content_type VARCHAR(120),
  size         BIGINT,
  checksum     VARCHAR(80),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_storage_tenant ON storage_objects(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_storage_entity ON storage_objects(tenant_id, entity_type, entity_id);

-- ── 7) password_reset_tokens — reset seguro de senha (§10) ───────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(120) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_reset_tokens(user_id);

-- ── 8) users: colunas de segurança de acesso (§9/§10) — aditivas ─────────────
-- is_active já é usado pelos modelos existentes; garantimos a coluna (idempotente).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ; -- invalida tokens emitidos antes

-- ── 9) calendar_events: vínculos da locadora (aditivo; reusa a tabela) ───────
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS rental_id      UUID REFERENCES rentals(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS vehicle_id     UUID REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS maintenance_id UUID REFERENCES vehicle_maintenances(id) ON DELETE SET NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority       VARCHAR(20);
CREATE INDEX IF NOT EXISTS idx_calendar_rental ON calendar_events(tenant_id, rental_id);

-- ── 10) rentals: VISTORIA (§8) — checklist estruturado na retirada e devolução.
-- JSONB reaproveita a própria locação (sem tabela paralela). Fotos continuam em
-- rental_documents. { fuel, condition, items:{...}, damages:[...], notes }.
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS pickup_inspection JSONB;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS return_inspection JSONB;

-- =============================================================================
-- FIM — LocaCore Ciclo 5.
-- =============================================================================
