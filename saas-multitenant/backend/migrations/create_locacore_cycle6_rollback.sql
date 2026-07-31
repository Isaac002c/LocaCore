-- =============================================================================
-- Rollback do Ciclo 6. Remove as colunas de assentos, conta protegida e
-- higiene de acesso. Não há perda de dado operacional (nenhuma tabela cai).
-- =============================================================================

DROP INDEX IF EXISTS idx_users_tenant_protected;

ALTER TABLE users   DROP COLUMN IF EXISTS password_changed_at;
ALTER TABLE users   DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE users   DROP COLUMN IF EXISTS must_change_password;
ALTER TABLE users   DROP COLUMN IF EXISTS is_protected;
ALTER TABLE tenants DROP COLUMN IF EXISTS user_seats;
