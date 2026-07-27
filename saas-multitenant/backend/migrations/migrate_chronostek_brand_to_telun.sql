-- =============================================================================
-- Migration: marca CHRONOSTEK → TELUN (camada institucional da PLATAFORMA)
--
-- Escopo: SOMENTE o tenant OPERADOR DA PLATAFORMA (host do painel master) e
-- textos institucionais do produto. NÃO toca em dados de clientes (Rental Log
-- e demais locadoras/despachantes) — a locadora é a OPERADORA da locação; a
-- TELUN é a FORNECEDORA da plataforma. São coisas distintas.
--
-- Propriedades: idempotente · não destrutiva · transacional · auditável ·
-- segura para PostgreSQL real · respeita tenant isolation.
--
-- Rollback: migrate_telun_brand_to_chronostek_rollback.sql
-- =============================================================================

BEGIN;

-- ── 1) Tenant operador da plataforma: chronostek → telun ─────────────────────
-- Preserva o MESMO id (não cria um segundo operador; FKs seguem válidas).
-- Só age se o slug antigo existir E o novo ainda não existir (idempotência +
-- proteção contra duplicidade).
DO $$
DECLARE
  v_old_id UUID;
  v_new_exists BOOLEAN;
BEGIN
  SELECT id INTO v_old_id FROM tenants WHERE slug = 'chronostek';
  SELECT EXISTS(SELECT 1 FROM tenants WHERE slug = 'telun') INTO v_new_exists;

  IF v_old_id IS NULL THEN
    RAISE NOTICE '[marca] slug chronostek ausente — nada a migrar (ok).';
  ELSIF v_new_exists THEN
    RAISE NOTICE '[marca] slug telun já existe — migração já aplicada (ok).';
  ELSE
    UPDATE tenants
       SET name = 'TELUN',
           slug = 'telun',
           updated_at = NOW()
     WHERE id = v_old_id;
    RAISE NOTICE '[marca] tenant operador migrado para TELUN (id=%).', v_old_id;
  END IF;
END $$;

-- ── 2) Usuário master: e-mail institucional ──────────────────────────────────
-- Apenas super_admin do tenant operador. Não altera senha nem sessões.
UPDATE users u
   SET email = 'contato@telun.com.br',
       name  = REPLACE(REPLACE(u.name, 'Chronostek', 'TELUN'), 'ChronosTek', 'TELUN'),
       updated_at = NOW()
  FROM tenants t
 WHERE u.tenant_id = t.id
   AND t.slug = 'telun'
   AND u.role = 'super_admin'
   AND u.email = 'contato@chronostek.com.br'
   AND NOT EXISTS (                       -- não cria colisão de e-mail no tenant
     SELECT 1 FROM users x
      WHERE x.tenant_id = u.tenant_id AND x.email = 'contato@telun.com.br'
   );

-- ── 3) Branding institucional em tenant_financial_settings ───────────────────
-- Só substitui a MARCA DA PLATAFORMA quando ela vazou para o campo; não mexe
-- na razão social das locadoras.
UPDATE tenant_financial_settings
   SET razao_social = REGEXP_REPLACE(razao_social, 'Chronos\s?Te(k|ch)', 'TELUN', 'gi'),
       updated_at = NOW()
 WHERE razao_social ~* 'Chronos\s?Te(k|ch)';

-- ── 4) Templates de mensagem: assinatura institucional ───────────────────────
UPDATE message_templates
   SET body = REGEXP_REPLACE(body, 'Chronos\s?Te(k|ch)', 'TELUN', 'gi'),
       updated_at = NOW()
 WHERE body ~* 'Chronos\s?Te(k|ch)';

-- ── 5) Configurações de contrato (cabeçalho/cláusulas/rodapé) ────────────────
UPDATE tenant_contract_settings
   SET header  = REGEXP_REPLACE(COALESCE(header, ''),  'Chronos\s?Te(k|ch)', 'TELUN', 'gi'),
       clauses = REGEXP_REPLACE(COALESCE(clauses, ''), 'Chronos\s?Te(k|ch)', 'TELUN', 'gi'),
       footer  = REGEXP_REPLACE(COALESCE(footer, ''),  'Chronos\s?Te(k|ch)', 'TELUN', 'gi'),
       updated_at = NOW()
 WHERE COALESCE(header, '') || COALESCE(clauses, '') || COALESCE(footer, '') ~* 'Chronos\s?Te(k|ch)';

-- ── 6) Auditoria: registra a execução ────────────────────────────────────────
-- Usa a própria tabela de logs quando existir; silencioso se ainda não existir.
DO $$
BEGIN
  IF to_regclass('public.activity_logs') IS NOT NULL THEN
    INSERT INTO activity_logs (tenant_id, action, entity_type, description, created_at)
    SELECT t.id, 'update', 'branding',
           'Migração de marca Chronostek → TELUN aplicada (plataforma).', NOW()
      FROM tenants t WHERE t.slug = 'telun';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[marca] log de auditoria ignorado: %', SQLERRM;
END $$;

COMMIT;

-- =============================================================================
-- Observações:
--  • Recibos e contratos JÁ EMITIDOS não são reescritos de propósito: são
--    documentos com valor histórico/fiscal e o snapshot deve refletir o que foi
--    entregue na época. Documentos NOVOS já saem com TELUN.
--  • Migrations antigas mantêm a marca no comentário de cabeçalho — alterá-las
--    mudaria o checksum e provocaria drift no runner. É registro histórico.
-- =============================================================================
