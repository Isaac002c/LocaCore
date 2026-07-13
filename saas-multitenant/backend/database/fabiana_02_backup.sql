-- ============================================================
-- SCRIPT 2/4 — BACKUP DO TENANT FABIANA
-- Cria schema temporário e copia todos os dados antes da exclusão.
-- Execute ANTES do script de exclusão.
-- ============================================================
-- SUBSTITUA :FABIANA_ID pelo UUID real do tenant.
-- ============================================================

BEGIN;

-- Criar schema de backup isolado
CREATE SCHEMA IF NOT EXISTS backup_fabiana;

-- Backup: tenant
CREATE TABLE backup_fabiana.tenants AS
  SELECT * FROM tenants WHERE id = :'FABIANA_ID';

-- Backup: users
CREATE TABLE backup_fabiana.users AS
  SELECT * FROM users WHERE tenant_id = :'FABIANA_ID';

-- Backup: clients
CREATE TABLE backup_fabiana.clients AS
  SELECT * FROM clients WHERE tenant_id = :'FABIANA_ID';

-- Backup: fines
CREATE TABLE backup_fabiana.fines AS
  SELECT * FROM fines WHERE tenant_id = :'FABIANA_ID';

-- Backup: fine_documents
CREATE TABLE backup_fabiana.fine_documents AS
  SELECT * FROM fine_documents WHERE tenant_id = :'FABIANA_ID';

-- Backup: fine_logs
CREATE TABLE backup_fabiana.fine_logs AS
  SELECT * FROM fine_logs WHERE tenant_id = :'FABIANA_ID';

-- Backup: leads
CREATE TABLE backup_fabiana.leads AS
  SELECT * FROM leads WHERE tenant_id = :'FABIANA_ID';

-- Backup: multas_leads
CREATE TABLE backup_fabiana.multas_leads AS
  SELECT * FROM multas_leads WHERE tenant_id = :'FABIANA_ID';

-- Backup: sellers
CREATE TABLE backup_fabiana.sellers AS
  SELECT * FROM sellers WHERE tenant_id = :'FABIANA_ID';

-- Backup: activity_logs
CREATE TABLE backup_fabiana.activity_logs AS
  SELECT * FROM activity_logs WHERE tenant_id = :'FABIANA_ID';

-- Backup: company_plans
CREATE TABLE backup_fabiana.company_plans AS
  SELECT * FROM company_plans WHERE tenant_id = :'FABIANA_ID';

-- Backup: company_targets (se existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'company_targets') THEN
    EXECUTE 'CREATE TABLE backup_fabiana.company_targets AS SELECT * FROM company_targets WHERE tenant_id = ''' || :'FABIANA_ID' || '''';
  END IF;
END $$;

-- Backup: lead_activities (se existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lead_activities') THEN
    EXECUTE 'CREATE TABLE backup_fabiana.lead_activities AS SELECT * FROM lead_activities WHERE tenant_id = ''' || :'FABIANA_ID' || '''';
  END IF;
END $$;

COMMIT;

-- Verificar backup
SELECT schemaname, tablename,
       (SELECT COUNT(*) FROM backup_fabiana.tenants)       AS tenants,
       (SELECT COUNT(*) FROM backup_fabiana.users)         AS users,
       (SELECT COUNT(*) FROM backup_fabiana.clients)       AS clients,
       (SELECT COUNT(*) FROM backup_fabiana.fines)         AS fines,
       (SELECT COUNT(*) FROM backup_fabiana.fine_documents)AS fine_documents,
       (SELECT COUNT(*) FROM backup_fabiana.fine_logs)     AS fine_logs,
       (SELECT COUNT(*) FROM backup_fabiana.leads)         AS leads,
       (SELECT COUNT(*) FROM backup_fabiana.multas_leads)  AS multas_leads,
       (SELECT COUNT(*) FROM backup_fabiana.sellers)       AS sellers,
       (SELECT COUNT(*) FROM backup_fabiana.activity_logs) AS activity_logs,
       (SELECT COUNT(*) FROM backup_fabiana.company_plans) AS company_plans
FROM information_schema.tables
WHERE table_schema = 'backup_fabiana'
  AND table_name = 'tenants'
LIMIT 1;
