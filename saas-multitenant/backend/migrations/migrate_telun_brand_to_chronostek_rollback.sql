-- =============================================================================
-- ROLLBACK: marca TELUN → CHRONOSTEK (reverte migrate_chronostek_brand_to_telun)
--
-- Reverte SOMENTE a identidade do tenant operador da plataforma e o e-mail do
-- super_admin. Idempotente e transacional. FAÇA BACKUP ANTES.
--
-- ⚠️ Não reverte os REGEXP_REPLACE de textos livres (settings/templates/
-- contratos): a substituição é lossy — não há como saber se o texto original
-- era "Chronostek", "ChronosTek" ou "Chronos Tech". Para esses campos,
-- restaure a partir do backup (deploy/backups/).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_id UUID;
  v_old_exists BOOLEAN;
BEGIN
  SELECT id INTO v_id FROM tenants WHERE slug = 'telun';
  SELECT EXISTS(SELECT 1 FROM tenants WHERE slug = 'chronostek') INTO v_old_exists;

  IF v_id IS NULL THEN
    RAISE NOTICE '[rollback] slug telun ausente — nada a reverter (ok).';
  ELSIF v_old_exists THEN
    RAISE NOTICE '[rollback] slug chronostek já existe — nada a fazer (ok).';
  ELSE
    UPDATE tenants
       SET name = 'Chronostek', slug = 'chronostek', updated_at = NOW()
     WHERE id = v_id;
    RAISE NOTICE '[rollback] tenant operador revertido (id=%).', v_id;
  END IF;
END $$;

UPDATE users u
   SET email = 'contato@chronostek.com.br',
       name  = REPLACE(u.name, 'TELUN', 'Chronostek'),
       updated_at = NOW()
  FROM tenants t
 WHERE u.tenant_id = t.id
   AND t.slug = 'chronostek'
   AND u.role = 'super_admin'
   AND u.email = 'contato@telun.com.br'
   AND NOT EXISTS (
     SELECT 1 FROM users x
      WHERE x.tenant_id = u.tenant_id AND x.email = 'contato@chronostek.com.br'
   );

COMMIT;
