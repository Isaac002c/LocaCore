-- =============================================================================
-- Migration: LocaCore — Ciclo 2 (produção)
-- -----------------------------------------------------------------------------
-- PURAMENTE ADITIVA e idempotente (ADD COLUMN/CREATE TABLE/INDEX IF NOT EXISTS).
-- Não altera nem remove nada existente. Aplicar DEPOIS de create_locacore_module.sql.
--
--   psql "$DATABASE_URL" -f migrations/create_locacore_cycle2.sql
--
-- Convenções: PK UUID (pgcrypto), tenant_id UUID NOT NULL REFERENCES tenants,
-- dinheiro NUMERIC(15,2), enums via VARCHAR+CHECK, timestamps TIMESTAMPTZ.
-- Rollback: create_locacore_cycle2_rollback.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) tenants.modules — áreas do produto habilitadas por tenant ─────────────
-- NULL = todas as áreas habilitadas (compatível com os tenants atuais).
-- Ex.: '["locacao","financeiro"]' para uma locadora. O gating é aplicado no
-- backend (middleware requireModule) e no frontend (sidebar/landing).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS modules JSONB;

-- ── 2) tenant_config_options — listas parametrizáveis por tenant (§2.3/§6) ────
-- Fonte única e genérica para listas configuráveis (categorias de veículo,
-- categorias de adicionais de locação, etc.). Desativação lógica (active),
-- nunca exclusão de item já usado.
CREATE TABLE IF NOT EXISTS tenant_config_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        VARCHAR(40) NOT NULL,          -- 'vehicle_category' | 'rental_extra_category' | ...
  value       VARCHAR(80) NOT NULL,          -- rótulo/valor exibido
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_config_options_tenant_kind
  ON tenant_config_options(tenant_id, kind, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_config_options
  ON tenant_config_options(tenant_id, kind, LOWER(value));

-- ── 3) rental_extras — adicionais/cobranças extras da locação (§9) ───────────
-- Itemizados. O total da locação passa a considerar a soma dos extras ativos
-- (rentals.extras_amount é mantido como agregado desta tabela).
CREATE TABLE IF NOT EXISTS rental_extras (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  rental_id     UUID NOT NULL REFERENCES rentals(id)  ON DELETE CASCADE,
  category      VARCHAR(60),
  description   TEXT,
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (unit_amount >= 0),
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  extra_date    DATE,
  status        VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rental_extras_tenant ON rental_extras(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_extras_rental ON rental_extras(tenant_id, rental_id);

-- =============================================================================
-- FIM — LocaCore Ciclo 2.
-- =============================================================================
