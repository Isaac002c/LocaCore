const pool = require('../config/db');

// ============================================
// PERMISSIONS MODEL - Permissões e Roles
// ============================================

// READ - Listar usuários do tenant com informações de role
const getUsersWithRoles = async (tenant_id) => {
  const result = await pool.query(
    `SELECT id, name, email, role, COALESCE(is_active, true) AS is_active,
            COALESCE(is_protected, FALSE) AS is_protected,
            COALESCE(must_change_password, FALSE) AS must_change_password,
            last_login_at, password_changed_at, created_at, updated_at
       FROM users
      WHERE tenant_id = $1
      ORDER BY COALESCE(is_protected, FALSE) ASC, name`,
    [tenant_id]
  );
  return result.rows;
};

// READ - Buscar usuário por ID
const getUserById = async (id, tenant_id) => {
  // is_protected acompanha o registro: as rotas decidem por ele se a conta pode
  // ser editada/excluída pelo tenant (services/userSeats.js).
  const result = await pool.query(
    `SELECT id, name, email, role, COALESCE(is_active, true) AS is_active,
            COALESCE(is_protected, FALSE) AS is_protected,
            COALESCE(must_change_password, FALSE) AS must_change_password,
            last_login_at, password_changed_at, created_at, updated_at
       FROM users
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenant_id]
  );
  return result.rows[0];
};

// CREATE - Criar novo usuário
// A senha inicial é definida por um administrador e entregue por mensagem —
// portanto nasce PROVISÓRIA (`must_change_password`): quem recebe é obrigado a
// definir a própria antes de usar o sistema.
const createUser = async ({
  tenant_id, name, email, password, role = 'viewer', must_change_password = true,
}) => {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role, is_active,
                        must_change_password, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, true, $6, NOW())
     RETURNING id, name, email, role, is_active, must_change_password, created_at`,
    [tenant_id, name, email, hashedPassword, role, !!must_change_password]
  );
  return result.rows[0];
};

// UPDATE - Atualizar usuário
const updateUser = async (id, { name, email, role, is_active }, tenant_id) => {
  const updates = [];
  const params = [];
  let paramIndex = 1;
  
  if (name !== undefined) {
    updates.push(`name = $${paramIndex}`);
    params.push(name);
    paramIndex++;
  }
  
  if (email !== undefined) {
    updates.push(`email = $${paramIndex}`);
    params.push(email);
    paramIndex++;
  }
  
  if (role !== undefined) {
    updates.push(`role = $${paramIndex}`);
    params.push(role);
    paramIndex++;
  }
  
  if (is_active !== undefined) {
    updates.push(`is_active = $${paramIndex}`);
    params.push(is_active);
    paramIndex++;
  }
  
  if (updates.length === 0) {
    return null;
  }
  
  updates.push(`updated_at = NOW()`);
  params.push(id, tenant_id);
  
  const query = `
    UPDATE users 
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
    RETURNING id, name, email, role, is_active, updated_at
  `;
  
  const result = await pool.query(query, params);
  return result.rows[0];
};

// UPDATE - Atualizar senha. Invalida TODAS as sessões anteriores (§10):
// sessions_valid_after = NOW() → tokens emitidos antes deixam de valer.
// Definir senha: invalida as sessões existentes, limpa a exigência de troca e
// registra quando a senha passou a valer. `forceChange` marca a NOVA senha como
// provisória (admin redefinindo a senha de outra pessoa).
const updateUserPassword = async (id, password, tenant_id, { forceChange = false } = {}) => {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `UPDATE users
        SET password_hash = $1,
            sessions_valid_after = NOW(),
            must_change_password = $4,
            password_changed_at = NOW(),
            updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING id`,
    [hashedPassword, id, tenant_id, !!forceChange]
  );
  return result.rows[0];
};

// Marca/desmarca a exigência de troca de senha sem alterar a senha em si.
const setMustChangePassword = async (id, must, tenant_id) => {
  const result = await pool.query(
    `UPDATE users SET must_change_password = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3 RETURNING id, must_change_password`,
    [!!must, id, tenant_id]
  );
  return result.rows[0];
};

// UPDATE - Ativa/desativa usuário (§9). Ao DESATIVAR, invalida as sessões
// existentes imediatamente (sessions_valid_after = NOW()).
const setUserActive = async (id, is_active, tenant_id) => {
  const result = await pool.query(
    `UPDATE users
        SET is_active = $1,
            sessions_valid_after = CASE WHEN $1 = false THEN NOW() ELSE sessions_valid_after END,
            updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, name, email, role, is_active`,
    [!!is_active, id, tenant_id]
  );
  return result.rows[0];
};

// READ - Estado de acesso p/ enforcement por requisição (leve, tolerante a
// ausência das colunas em bancos pré-migração via COALESCE).
const getUserAuthState = async (id, tenant_id) => {
  const result = await pool.query(
    `SELECT COALESCE(is_active, true) AS is_active, sessions_valid_after
       FROM users WHERE id = $1 AND tenant_id = $2`,
    [id, tenant_id]
  );
  return result.rows[0];
};

// DELETE - Deletar usuário
const deleteUser = async (id, tenant_id) => {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 AND tenant_id = $2 RETURNING id',
    [id, tenant_id]
  );
  return result.rows[0];
};

// READ - Contar usuários do tenant
const countUsers = async (tenant_id) => {
  const result = await pool.query(
    'SELECT COUNT(*) as total FROM users WHERE tenant_id = $1',
    [tenant_id]
  );
  return parseInt(result.rows[0].total);
};

// READ - Contar usuários ativos
const countActiveUsers = async (tenant_id) => {
  const result = await pool.query(
    'SELECT COUNT(*) as total FROM users WHERE tenant_id = $1 AND is_active = true',
    [tenant_id]
  );
  return parseInt(result.rows[0].total);
};

// READ - Estatísticas de usuários por role
const getUsersStats = async (tenant_id) => {
  const result = await pool.query(
    `SELECT role, COUNT(*) as count, COUNT(CASE WHEN is_active = true THEN 1 END) as active_count
     FROM users 
     WHERE tenant_id = $1
     GROUP BY role`,
    [tenant_id]
  );
  return result.rows;
};

// Verificar se email já existe no tenant
const checkEmailExists = async (email, tenant_id) => {
  const result = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
    [email, tenant_id]
  );
  return result.rows.length > 0;
};

module.exports = {
  getUsersWithRoles,
  getUserById,
  createUser,
  updateUser,
  updateUserPassword,
  setMustChangePassword,
  setUserActive,
  getUserAuthState,
  deleteUser,
  countUsers,
  countActiveUsers,
  getUsersStats,
  checkEmailExists
};

