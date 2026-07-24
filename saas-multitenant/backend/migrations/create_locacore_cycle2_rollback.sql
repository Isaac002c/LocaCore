-- =============================================================================
-- ROLLBACK: LocaCore — Ciclo 2
-- Reversível e idempotente. Remove SOMENTE o que create_locacore_cycle2.sql criou.
-- ATENÇÃO: remove adicionais de locação e listas de configuração por tenant.
-- Faça backup antes.
-- =============================================================================

DROP TABLE IF EXISTS rental_extras CASCADE;
DROP TABLE IF EXISTS tenant_config_options CASCADE;

-- Remove a coluna de módulos por tenant (volta ao comportamento "todas as áreas").
ALTER TABLE tenants DROP COLUMN IF EXISTS modules;

-- =============================================================================
-- FIM do rollback do Ciclo 2.
-- =============================================================================
