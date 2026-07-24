-- =============================================================================
-- ROLLBACK: LocaCore — Ciclo 4. Reversível e idempotente.
-- =============================================================================
DROP TABLE IF EXISTS vehicle_maintenances CASCADE;
DROP TABLE IF EXISTS alert_log CASCADE;
DROP TABLE IF EXISTS system_heartbeats CASCADE;
DROP TABLE IF EXISTS job_locks CASCADE;
-- =============================================================================
