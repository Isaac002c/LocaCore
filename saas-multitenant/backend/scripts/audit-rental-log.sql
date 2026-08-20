-- =============================================================================
-- audit-rental-log.sql — Auditoria de prontidão de DADOS por tenant (§27/§55).
-- SOMENTE LEITURA (nenhum UPDATE/INSERT/DELETE). Seguro contra produção.
--
-- Uso (na VPS, read-only):
--   docker exec -i locacore-postgres psql -U locacore -d locacore -f - < audit-rental-log.sql
-- ou:
--   docker exec -i locacore-postgres psql -U locacore -d locacore < audit-rental-log.sql
--
-- As colunas ncm / weekly_rate / billing_frequency exigem o Ciclo 9 aplicado.
-- Enquanto não migrado, use a seção "PRÉ-CICLO 9" (valor por daily_rate/total).
-- =============================================================================
\pset pager off
SELECT id AS tid, name FROM tenants
  WHERE name ILIKE '%rental%' OR slug ILIKE '%rental%' ORDER BY created_at LIMIT 1 \gset

\echo '================ TENANT ================'
SELECT :'tid' AS tenant_id, name FROM tenants WHERE id = :'tid';

\echo '================ LOCACOES ATIVAS ================'
-- "ativa" = em_andamento ou atrasado (mesmo critério do scheduler/readiness).
SELECT
  COUNT(*) FILTER (WHERE status IN ('em_andamento','atrasado'))                                   AS ativas,
  COUNT(*)                                                                                        AS total
FROM rentals WHERE tenant_id = :'tid';

\echo '================ LOCACOES ATIVAS - VALOR SEGURO ================'
-- Prioridade §17: weekly_rate > fonte total explícita > diária. Sem coluna do
-- Ciclo 9, o proxy é daily_rate/total_amount. Ajuste o SELECT conforme migrado.
SELECT
  COUNT(*) FILTER (WHERE
    (to_jsonb(r) ? 'weekly_rate' AND (r).weekly_rate IS NOT NULL AND (r).weekly_rate > 0)
    OR (daily_rate IS NOT NULL AND daily_rate > 0)
    OR (total_amount IS NOT NULL AND total_amount > 0)
  ) AS com_valor,
  COUNT(*) FILTER (WHERE
    NOT (
      (to_jsonb(r) ? 'weekly_rate' AND (r).weekly_rate IS NOT NULL AND (r).weekly_rate > 0)
      OR (daily_rate IS NOT NULL AND daily_rate > 0)
      OR (total_amount IS NOT NULL AND total_amount > 0)
    )
  ) AS sem_valor
FROM rentals r WHERE tenant_id = :'tid' AND status IN ('em_andamento','atrasado');

\echo '================ CLIENTES DE LOCACOES ATIVAS (telefone / CPF) ================'
SELECT
  COUNT(DISTINCT r.client_id) AS clientes_ativos,
  COUNT(DISTINCT r.client_id) FILTER (WHERE NULLIF(regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g'),'') IS NOT NULL) AS com_telefone,
  COUNT(DISTINCT r.client_id) FILTER (WHERE NULLIF(regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g'),'') IS NULL)     AS sem_telefone,
  COUNT(DISTINCT r.client_id) FILTER (WHERE NULLIF(regexp_replace(COALESCE(c.cpf,''),'[^0-9]','','g'),'') IS NOT NULL)   AS com_cpf,
  COUNT(DISTINCT r.client_id) FILTER (WHERE NULLIF(regexp_replace(COALESCE(c.cpf,''),'[^0-9]','','g'),'') IS NULL)       AS sem_cpf
FROM rentals r LEFT JOIN clients c ON c.id = r.client_id AND c.tenant_id = r.tenant_id
WHERE r.tenant_id = :'tid' AND r.status IN ('em_andamento','atrasado');

\echo '================ VEICULOS / NCM (NCM exige Ciclo 9) ================'
SELECT
  COUNT(*) AS veiculos_total,
  COUNT(*) FILTER (WHERE to_jsonb(v) ? 'ncm' AND NULLIF(TRIM((v).ncm),'') IS NOT NULL) AS com_ncm,
  COUNT(*) FILTER (WHERE NOT (to_jsonb(v) ? 'ncm') OR NULLIF(TRIM((v).ncm),'') IS NULL) AS sem_ncm
FROM vehicles v WHERE tenant_id = :'tid';

\echo '================ COLUNAS DO CICLO 9 PRESENTES? (vazio = ainda nao migrado) ================'
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name='rentals' AND column_name IN ('weekly_rate','billing_frequency','billing_value_source'))
   OR (table_name='vehicles' AND column_name IN ('ncm','fiscal_description'))
   OR (table_name='automation_settings' AND column_name IN ('receipts_enabled','nfse_enabled','nfse_mandatory_from'))
ORDER BY table_name, column_name;
