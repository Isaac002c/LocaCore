-- ============================================================
-- SCRIPT 4/4 — ROLLBACK (RESTAURAÇÃO DO TENANT FABIANA)
-- Execute SOMENTE se precisar desfazer a exclusão.
-- Requer que o schema backup_fabiana ainda exista.
-- ============================================================

BEGIN;

-- Verificar que o backup existe
SELECT COUNT(*) AS registros_backup FROM backup_fabiana.tenants;

-- Restaurar tenant
INSERT INTO tenants SELECT * FROM backup_fabiana.tenants
  ON CONFLICT (id) DO NOTHING;

-- Restaurar users
INSERT INTO users SELECT * FROM backup_fabiana.users
  ON CONFLICT (id) DO NOTHING;

-- Restaurar sellers (antes de fines, pois fines referencia seller_id)
INSERT INTO sellers SELECT * FROM backup_fabiana.sellers
  ON CONFLICT (id) DO NOTHING;

-- Restaurar clients
INSERT INTO clients SELECT * FROM backup_fabiana.clients
  ON CONFLICT (id) DO NOTHING;

-- Restaurar fines
INSERT INTO fines SELECT * FROM backup_fabiana.fines
  ON CONFLICT (id) DO NOTHING;

-- Restaurar fine_documents
INSERT INTO fine_documents SELECT * FROM backup_fabiana.fine_documents
  ON CONFLICT (id) DO NOTHING;

-- Restaurar fine_logs
INSERT INTO fine_logs SELECT * FROM backup_fabiana.fine_logs
  ON CONFLICT (id) DO NOTHING;

-- Restaurar leads
INSERT INTO leads SELECT * FROM backup_fabiana.leads
  ON CONFLICT (id) DO NOTHING;

-- Restaurar multas_leads
INSERT INTO multas_leads SELECT * FROM backup_fabiana.multas_leads
  ON CONFLICT (id) DO NOTHING;

-- Restaurar activity_logs
INSERT INTO activity_logs SELECT * FROM backup_fabiana.activity_logs
  ON CONFLICT (id) DO NOTHING;

-- Restaurar company_plans
INSERT INTO company_plans SELECT * FROM backup_fabiana.company_plans
  ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verificar restauração
SELECT 'users'        AS tabela, COUNT(*) FROM users          WHERE tenant_id = (SELECT id FROM backup_fabiana.tenants LIMIT 1)
UNION ALL
SELECT 'clients',               COUNT(*) FROM clients         WHERE tenant_id = (SELECT id FROM backup_fabiana.tenants LIMIT 1)
UNION ALL
SELECT 'fines',                 COUNT(*) FROM fines           WHERE tenant_id = (SELECT id FROM backup_fabiana.tenants LIMIT 1)
UNION ALL
SELECT 'leads',                 COUNT(*) FROM leads           WHERE tenant_id = (SELECT id FROM backup_fabiana.tenants LIMIT 1)
ORDER BY tabela;

-- Após confirmar a restauração, remova o schema de backup se desejar:
-- DROP SCHEMA backup_fabiana CASCADE;
