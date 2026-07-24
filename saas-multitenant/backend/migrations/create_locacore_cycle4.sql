-- =============================================================================
-- Migration: LocaCore — Ciclo 4 (Produção: locks, heartbeats, alertas, manutenções)
-- -----------------------------------------------------------------------------
-- PURAMENTE ADITIVA e idempotente. Aplicar DEPOIS de create_locacore_cycle3.sql.
--   psql "$DATABASE_URL" -f migrations/create_locacore_cycle4.sql
-- Rollback: create_locacore_cycle4_rollback.sql
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) job_locks — lock distribuído por lease (worker/scheduler) ─────────────
-- Impede duas instâncias de rodarem o mesmo job simultaneamente. TTL via expires_at.
CREATE TABLE IF NOT EXISTS job_locks (
  name        VARCHAR(80) PRIMARY KEY,
  owner       VARCHAR(120) NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- ── 2) system_heartbeats — liveness de worker/scheduler p/ /health/ready ─────
CREATE TABLE IF NOT EXISTS system_heartbeats (
  service    VARCHAR(60) PRIMARY KEY,
  last_beat  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ── 3) alert_log — alertas com cooldown/severidade/agrupamento ───────────────
CREATE TABLE IF NOT EXISTS alert_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  kind        VARCHAR(60) NOT NULL,
  severity    VARCHAR(20) NOT NULL DEFAULT 'warning'
              CHECK (severity IN ('info','warning','critical')),
  message     TEXT,
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alert_log_open ON alert_log(kind) WHERE resolved_at IS NULL;

-- ── 4) vehicle_maintenances — manutenções da frota (§27) ─────────────────────
-- Veículo em manutenção (status 'manutencao') não é elegível para locação — a
-- disponibilidade já deriva do status do veículo (vehicleModels.refreshVehicleStatus).
CREATE TABLE IF NOT EXISTS vehicle_maintenances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id         UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type               VARCHAR(60),                 -- preventiva/corretiva/revisão...
  status             VARCHAR(20) NOT NULL DEFAULT 'agendada'
                     CHECK (status IN ('agendada','em_andamento','concluida','cancelada')),
  scheduled_date     DATE,
  done_date          DATE,
  odometer_scheduled INTEGER,
  odometer_done      INTEGER,
  cost               NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  supplier           VARCHAR(160),
  notes              TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_maint_tenant  ON vehicle_maintenances(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_maint_vehicle ON vehicle_maintenances(tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maint_sched   ON vehicle_maintenances(tenant_id, scheduled_date);

-- =============================================================================
-- FIM — LocaCore Ciclo 4.
-- =============================================================================
