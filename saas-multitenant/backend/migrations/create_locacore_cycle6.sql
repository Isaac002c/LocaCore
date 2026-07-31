-- =============================================================================
-- LocaCore — Ciclo 6: limite de assentos de usuário, conta protegida do
-- fornecedor e higiene de acesso (troca de senha obrigatória, último acesso).
--
-- Idempotente: pode ser reaplicada com segurança.
-- Rollback: create_locacore_cycle6_rollback.sql
-- =============================================================================

-- ── 1) Assentos de usuário por tenant ────────────────────────────────────────
-- Regra comercial parametrizada por tenant (não fixada no código): a Rental Log
-- opera com 4 usuários. A conta do fornecedor NÃO ocupa assento (ver item 2).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS user_seats INT NOT NULL DEFAULT 4;

COMMENT ON COLUMN tenants.user_seats IS
  'Quantos usuários próprios o tenant pode manter. Contas com is_protected=TRUE não ocupam assento.';

-- ── 2) Conta protegida do fornecedor (suporte/operador da plataforma) ────────
-- Uma conta protegida:
--   · não pode ser editada, desativada nem excluída pelo tenant;
--   · não conta no limite de assentos;
--   · continua visível na lista (transparência), marcada como "Suporte TELUN".
-- Existe para que o fornecedor mantenha acesso de suporte mesmo que o cliente
-- reorganize a própria equipe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.is_protected IS
  'Conta do fornecedor (suporte). Imutável para o tenant e fora do limite de assentos.';

-- ── 3) Higiene de acesso ─────────────────────────────────────────────────────
-- Senhas iniciais entregues por mensagem são consideradas EXPOSTAS: o usuário
-- precisa definir uma nova no primeiro acesso.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.must_change_password IS
  'TRUE força a definição de uma nova senha no próximo login (senha inicial exposta).';
COMMENT ON COLUMN users.last_login_at IS 'Último login bem-sucedido (auditoria de acesso).';
COMMENT ON COLUMN users.password_changed_at IS 'Quando a senha foi definida pela última vez.';

-- Índice para a contagem de assentos (lista de usuários por tenant é frequente).
CREATE INDEX IF NOT EXISTS idx_users_tenant_protected ON users (tenant_id, is_protected);
