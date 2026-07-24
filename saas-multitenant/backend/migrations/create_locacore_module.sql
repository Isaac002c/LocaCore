-- =============================================================================
-- Migration: Módulo LocaCore (Locadora de Veículos) — Frota + Locações
-- -----------------------------------------------------------------------------
-- Adapta a base multi-tenant para a operação de LOCADORA DE VEÍCULOS, de forma
-- PURAMENTE ADITIVA. TODAS as statements são idempotentes
-- (CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT
-- protegido por DO/EXCEPTION), portanto o script pode ser reexecutado com segurança.
--
-- NÃO altera nem remove nenhuma tabela/coluna existente. Preserva integralmente o
-- domínio de despachante (fines/processos) e todos os dados/tenants atuais.
--
-- Ordem de aplicação (idempotente):
--   psql "$DATABASE_URL" -f migrations/000_nexos_schema.sql
--   psql "$DATABASE_URL" -f migrations/create_financial_module.sql
--   psql "$DATABASE_URL" -f migrations/create_locacore_module.sql   <-- este
--
-- Convenções do projeto:
--   * PKs UUID (gen_random_uuid) — extensão pgcrypto.
--   * tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE.
--   * Valores monetários em NUMERIC(15,2) — NUNCA ponto flutuante (§8.5).
--   * created_at / updated_at TIMESTAMPTZ DEFAULT NOW().
--   * Enums implementados como VARCHAR + CHECK.
--   * Vínculos financeiros usam ON DELETE SET NULL para PRESERVAR o histórico.
-- Rollback: ver create_locacore_module_rollback.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. vehicles — FROTA própria da locadora (veículos disponíveis para locação)
--    Distinta de company_vehicles (frota de EMPRESAS clientes no fluxo despachante):
--    aqui o veículo pertence ao tenant (a locadora) e é o objeto locado.
-- =============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plate         VARCHAR(10),
  brand         VARCHAR(80),
  model         VARCHAR(120),
  year          INTEGER,
  color         VARCHAR(40),
  category      VARCHAR(60),                 -- hatch, sedan, SUV, utilitário... (config por tenant)
  renavam       VARCHAR(20),
  chassi        VARCHAR(30),
  fuel          VARCHAR(20),                 -- combustível
  transmission  VARCHAR(20),                 -- câmbio (manual/automático)
  daily_rate    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),  -- diária padrão
  odometer      INTEGER NOT NULL DEFAULT 0 CHECK (odometer >= 0),          -- km atual
  status        VARCHAR(20) NOT NULL DEFAULT 'disponivel'
                CHECK (status IN ('disponivel','alugado','manutencao','inativo')),
  notes         TEXT,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant        ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_status ON vehicles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_plate  ON vehicles(tenant_id, plate);
-- Placa única por tenant (quando informada) — evita duplicidade de veículo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_tenant_plate
  ON vehicles(tenant_id, UPPER(plate)) WHERE plate IS NOT NULL AND plate <> '';

-- =============================================================================
-- 2. rentals — LOCAÇÕES (entidade operacional central do LocaCore)
--    Liga um cliente (locatário) a um veículo, com período, diárias e valores.
--    client_id / vehicle_id usam ON DELETE SET NULL para preservar o histórico
--    da locação mesmo se o cadastro de origem for removido.
-- =============================================================================
CREATE TABLE IF NOT EXISTS rentals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rental_number    VARCHAR(40),                       -- identificador humano (LOC-000001)
  client_id        UUID REFERENCES clients(id)  ON DELETE SET NULL,   -- locatário
  vehicle_id       UUID REFERENCES vehicles(id) ON DELETE SET NULL,   -- veículo locado
  status           VARCHAR(20) NOT NULL DEFAULT 'reservado'
                   CHECK (status IN ('reservado','em_andamento','atrasado','finalizado','cancelado')),
  start_date       DATE,                              -- retirada (prevista/efetiva)
  end_date         DATE,                              -- devolução prevista
  return_date      DATE,                              -- devolução efetiva
  daily_rate       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),      -- diária contratada
  days             INTEGER       NOT NULL DEFAULT 1 CHECK (days >= 0),            -- nº de diárias
  extras_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (extras_amount >= 0),   -- taxas/adicionais
  discount_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0), -- descontos
  total_amount     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),    -- total da locação
  deposit_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),  -- caução
  pickup_odometer  INTEGER,
  return_odometer  INTEGER,
  pickup_location  VARCHAR(160),
  return_location  VARCHAR(160),
  notes            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rentals_tenant        ON rentals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rentals_tenant_status ON rentals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_client        ON rentals(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_rentals_vehicle       ON rentals(tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_start         ON rentals(tenant_id, start_date);
CREATE INDEX IF NOT EXISTS idx_rentals_end           ON rentals(tenant_id, end_date);
CREATE INDEX IF NOT EXISTS idx_rentals_created       ON rentals(tenant_id, created_at);

-- =============================================================================
-- 3. Vínculos com o módulo FINANCEIRO e DOCUMENTOS (aditivo, condicional)
--    Espelha o vínculo fine_id (processo) já existente: agora uma LOCAÇÃO pode
--    ser faturada, receber pagamentos, gerar recibos e anexar documentos.
--    Protegido por to_regclass: não falha se o módulo financeiro ainda não existir.
-- =============================================================================
DO $$
BEGIN
  IF to_regclass('public.service_billings') IS NOT NULL THEN
    ALTER TABLE service_billings ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_billings_rental ON service_billings(tenant_id, rental_id);
  END IF;

  IF to_regclass('public.payments') IS NOT NULL THEN
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_payments_rental ON payments(tenant_id, rental_id);
  END IF;

  IF to_regclass('public.financial_transactions') IS NOT NULL THEN
    ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_fin_tx_rental ON financial_transactions(tenant_id, rental_id);
  END IF;

  IF to_regclass('public.receipts') IS NOT NULL THEN
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_receipts_rental ON receipts(tenant_id, rental_id);
  END IF;

  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS vehicle_asset_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_documents_rental        ON documents(tenant_id, rental_id);
    CREATE INDEX IF NOT EXISTS idx_documents_vehicle_asset ON documents(tenant_id, vehicle_asset_id);
  END IF;
END $$;

-- =============================================================================
-- FIM — Módulo LocaCore (Frota + Locações).
-- =============================================================================
