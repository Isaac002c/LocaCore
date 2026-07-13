-- ============================================================
-- SCRIPT 3/4 — EXCLUSÃO DO TENANT FABIANA
-- Execute SOMENTE após confirmar o backup (script 2) e o
-- diagnóstico (script 1). A exclusão usa CASCADE automático.
-- ============================================================
-- PRÉ-REQUISITOS:
--   1. Script 1 rodado e tenant identificado
--   2. Script 2 rodado e backup confirmado
--   3. SUBSTITUA :FABIANA_ID pelo UUID real
-- ============================================================

BEGIN;

-- Snapshot pré-exclusão para o relatório final
CREATE TEMP TABLE _pre_delete_counts AS
SELECT
  (SELECT COUNT(*) FROM users          WHERE tenant_id = :'FABIANA_ID') AS users,
  (SELECT COUNT(*) FROM clients        WHERE tenant_id = :'FABIANA_ID') AS clients,
  (SELECT COUNT(*) FROM fines          WHERE tenant_id = :'FABIANA_ID') AS fines,
  (SELECT COUNT(*) FROM fine_documents WHERE tenant_id = :'FABIANA_ID') AS fine_documents,
  (SELECT COUNT(*) FROM fine_logs      WHERE tenant_id = :'FABIANA_ID') AS fine_logs,
  (SELECT COUNT(*) FROM leads          WHERE tenant_id = :'FABIANA_ID') AS leads,
  (SELECT COUNT(*) FROM multas_leads   WHERE tenant_id = :'FABIANA_ID') AS multas_leads,
  (SELECT COUNT(*) FROM sellers        WHERE tenant_id = :'FABIANA_ID') AS sellers,
  (SELECT COUNT(*) FROM activity_logs  WHERE tenant_id = :'FABIANA_ID') AS activity_logs,
  (SELECT COUNT(*) FROM company_plans  WHERE tenant_id = :'FABIANA_ID') AS company_plans;

-- Exibir o que será removido
SELECT * FROM _pre_delete_counts;

-- ============================================================
-- EXCLUSÃO EM CASCATA
-- A FK `tenant_id REFERENCES tenants(id) ON DELETE CASCADE`
-- garante que todos os dados filhos são removidos automaticamente.
-- ============================================================

DELETE FROM tenants WHERE id = :'FABIANA_ID';

-- Verificar que não sobrou nada
SELECT
  (SELECT COUNT(*) FROM users          WHERE tenant_id = :'FABIANA_ID') AS users_restantes,
  (SELECT COUNT(*) FROM clients        WHERE tenant_id = :'FABIANA_ID') AS clients_restantes,
  (SELECT COUNT(*) FROM fines          WHERE tenant_id = :'FABIANA_ID') AS fines_restantes,
  (SELECT COUNT(*) FROM leads          WHERE tenant_id = :'FABIANA_ID') AS leads_restantes,
  (SELECT COUNT(*) FROM multas_leads   WHERE tenant_id = :'FABIANA_ID') AS multas_leads_restantes;

-- Se todas as colunas acima forem 0, a exclusão foi completa.
-- Confirme e dê COMMIT apenas se estiver tudo certo.

COMMIT;

-- Relatório pós-exclusão
SELECT
  'Exclusão concluída' AS status,
  NOW() AS executado_em,
  :'FABIANA_ID' AS tenant_removido;
