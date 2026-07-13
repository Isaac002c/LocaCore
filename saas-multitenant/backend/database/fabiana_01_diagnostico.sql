-- ============================================================
-- SCRIPT 1/4 — DIAGNÓSTICO DO TENANT FABIANA
-- Execute PRIMEIRO para identificar o tenant e contar registros.
-- Não faz nenhuma alteração no banco.
-- ============================================================

-- PASSO 1: Listar todos os tenants (identifique o ID da Fabiana abaixo)
SELECT id, name, created_at
FROM tenants
ORDER BY created_at ASC;

-- ============================================================
-- SUBSTITUA :FABIANA_TENANT_ID pelo UUID retornado acima
-- antes de rodar o restante deste script.
-- Exemplo: \set FABIANA_ID 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
-- ============================================================

-- PASSO 2: Confirmar qual tenant será removido
SELECT id, name, created_at
FROM tenants
WHERE id = :'FABIANA_ID';

-- PASSO 3: Contar registros por tabela

SELECT 'users'          AS tabela, COUNT(*) AS registros FROM users          WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'clients',                  COUNT(*)              FROM clients         WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'fines',                    COUNT(*)              FROM fines           WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'fine_documents',           COUNT(*)              FROM fine_documents  WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'fine_logs',                COUNT(*)              FROM fine_logs       WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'leads',                    COUNT(*)              FROM leads           WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'multas_leads',             COUNT(*)              FROM multas_leads    WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'sellers',                  COUNT(*)              FROM sellers         WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'activity_logs',            COUNT(*)              FROM activity_logs   WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'company_plans',            COUNT(*)              FROM company_plans   WHERE tenant_id = :'FABIANA_ID'
ORDER BY tabela;

-- PASSO 4: Verificar dependências indiretas (company_targets, lead_activities)
SELECT 'company_targets'   AS tabela, COUNT(*) AS registros FROM company_targets  WHERE tenant_id = :'FABIANA_ID'
UNION ALL
SELECT 'lead_activities',            COUNT(*)              FROM lead_activities  WHERE tenant_id = :'FABIANA_ID';
