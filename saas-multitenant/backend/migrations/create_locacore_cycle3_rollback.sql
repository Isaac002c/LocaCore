-- =============================================================================
-- ROLLBACK: LocaCore — Ciclo 3 (Automação). Reversível e idempotente.
-- ATENÇÃO: remove as tabelas de automação e seus dados. Faça backup antes.
-- Não toca em nenhuma tabela dos ciclos anteriores.
-- =============================================================================

DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS external_costs CASCADE;
DROP TABLE IF EXISTS automation_runs CASCADE;
DROP TABLE IF EXISTS fiscal_documents CASCADE;
DROP TABLE IF EXISTS message_outbox CASCADE;
DROP TABLE IF EXISTS charges CASCADE;
DROP TABLE IF EXISTS message_templates CASCADE;
DROP TABLE IF EXISTS automation_settings CASCADE;

-- =============================================================================
-- FIM do rollback do Ciclo 3.
-- =============================================================================
