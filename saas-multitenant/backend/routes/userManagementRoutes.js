const express = require('express');
const router = express.Router();
const permissionModel = require('../models/permissionModels');
const { checkPermission, requireAdminOrManager, getAllRoles } = require('../middlewares/checkPermission');
const saasModel = require('../models/saasModels');
const seats = require('../services/userSeats');

// Traduz SeatError (assento esgotado / conta protegida) em resposta HTTP.
const seatErr = (res, err) => {
  if (err && err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
  return null;
};

// GET /api/users/management - Listar usuários do tenant
router.get('/', checkPermission('users:read'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [users, usage] = await Promise.all([
      permissionModel.getUsersWithRoles(tenantId),
      seats.getSeatUsage(tenantId),
    ]);
    // `seats` acompanha a lista para a UI saber quantas vagas restam e quais
    // contas são do suporte (imutáveis) sem precisar de outra chamada.
    res.json({ success: true, data: users, seats: usage });
  } catch (err) {
    console.error('Erro ao buscar usuários:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/management/stats - Estatísticas de usuários
router.get('/stats', checkPermission('users:read'), async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const [stats, total] = await Promise.all([
      permissionModel.getUsersStats(tenantId),
      permissionModel.countUsers(tenantId)
    ]);
    res.json({ success: true, data: { stats, total } });
  } catch (err) {
    console.error('Erro ao buscar stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/management/roles - Listar roles disponíveis
router.get('/roles', async (req, res) => {
  try {
    const roles = getAllRoles();
    const permissionsMap = {
      admin: 'Acesso total ao sistema',
      manager: 'Gerenciamento de clientes, contratos e documentos',
      operator: 'Operação básica: criar e editar',
      viewer: 'Apenas visualização'
    };
    
    const rolesWithDesc = roles.map(role => ({
      name: role,
      description: permissionsMap[role] || ''
    }));
    
    res.json({ success: true, data: rolesWithDesc });
  } catch (err) {
    console.error('Erro ao buscar roles:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/users/management/:id - Buscar usuário por ID
router.get('/:id', checkPermission('users:read'), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    
    const user = await permissionModel.getUserById(id, tenantId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/users/management - Criar novo usuário
router.post('/', requireAdminOrManager, async (req, res) => {
  try {
    const { name, email, password, role = 'viewer' } = req.body;
    const tenantId = req.tenantId;
    
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nome, email e senha são obrigatórios' 
      });
    }
    
    // Assentos: o tenant tem um número contratado de usuários (contas de
    // suporte do fornecedor não ocupam vaga).
    try { await seats.assertCanCreateUser(tenantId); }
    catch (e) { const r = seatErr(res, e); if (r) return r; throw e; }

    // Verificar se email já existe
    const emailExists = await permissionModel.checkEmailExists(email, tenantId);
    if (emailExists) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email já está em uso' 
      });
    }
    
    const user = await permissionModel.createUser({
      tenant_id: tenantId,
      name,
      email,
      password,
      role
    });
    
    // Log de atividade
    await saasModel.createActivityLog({
      tenant_id: tenantId,
      user_id: req.userId,
      action: 'create',
      entity_type: 'user',
      entity_id: user.id,
      description: `Usuário ${name} (${role}) criado`,
      metadata: { user_email: email }
    });
    
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/users/management/:id - Atualizar usuário
router.put('/:id', checkPermission('users:update'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, is_active } = req.body;
    const tenantId = req.tenantId;
    
    // Usuário só pode ser atualizado por admin/manager ou pelo próprio usuário
    const currentUserRole = req.userRole;
    if (currentUserRole !== 'admin' && currentUserRole !== 'manager' && req.userId !== id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você só pode atualizar seu próprio perfil' 
      });
    }
    
    // Verificar se o usuário pertence ao tenant
    const existingUser = await permissionModel.getUserById(id, tenantId);
    if (!existingUser) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    
    // Conta de suporte do fornecedor é imutável para o tenant.
    try { seats.assertNotProtected(existingUser, 'editar'); }
    catch (e) { const r = seatErr(res, e); if (r) return r; throw e; }

    // Se não for admin, não pode mudar role de outros usuários
    if (currentUserRole !== 'admin' && req.userId !== id && role) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você não pode alterar a função de outros usuários' 
      });
    }
    
    const user = await permissionModel.updateUser(id, {
      name,
      email,
      role,
      is_active
    }, tenantId);
    
    // Log de atividade
    await saasModel.createActivityLog({
      tenant_id: tenantId,
      user_id: req.userId,
      action: 'update',
      entity_type: 'user',
      entity_id: id,
      description: `Usuário ${name || existingUser.name} atualizado`,
      metadata: { changes: { name, email, role, is_active } }
    });
    
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/users/management/:id/password - Alterar senha
router.patch('/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const tenantId = req.tenantId;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Senha é obrigatória' 
      });
    }
    
    // Usuário só pode alterar senha do próprio usuário ou admin
    if (req.userRole !== 'admin' && req.userId !== id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Você só pode alterar sua própria senha' 
      });
    }
    
    const alvo = await permissionModel.getUserById(id, tenantId);
    if (!alvo) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    // Só o próprio dono da conta de suporte pode trocar a senha dela.
    if (seats.isProtectedUser(alvo) && req.userId !== id) {
      try { seats.assertNotProtected(alvo, 'alterar'); }
      catch (e) { const r = seatErr(res, e); if (r) return r; throw e; }
    }

    // Se um admin redefine a senha de OUTRA pessoa, a senha nasce provisória:
    // quem recebe é obrigado a definir a própria no primeiro acesso.
    const redefinidaPorTerceiro = req.userId !== id;
    await permissionModel.updateUserPassword(id, password, tenantId, { forceChange: redefinidaPorTerceiro });
    
    // Log de atividade
    await saasModel.createActivityLog({
      tenant_id: tenantId,
      user_id: req.userId,
      action: 'update_password',
      entity_type: 'user',
      entity_id: id,
      description: 'Senha atualizada'
    });
    
    res.json({ success: true, message: 'Senha atualizada com sucesso' });
  } catch (err) {
    console.error('Erro ao alterar senha:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/users/management/:id/active - Ativar/desativar usuário (admin/manager).
// Desativar invalida as sessões existentes (sessions_valid_after=NOW()). §9
router.patch('/:id/active', requireAdminOrManager, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const isActive = req.body.is_active === true || req.body.is_active === 'true';

    if (req.userId === id && !isActive) {
      return res.status(400).json({ success: false, error: 'Você não pode desativar o próprio usuário.' });
    }
    const existing = await permissionModel.getUserById(id, tenantId);
    if (!existing) return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    try { seats.assertNotProtected(existing, isActive ? 'reativar' : 'desativar'); }
    catch (e) { const r = seatErr(res, e); if (r) return r; throw e; }

    const user = await permissionModel.setUserActive(id, isActive, tenantId);
    await saasModel.createActivityLog({
      tenant_id: tenantId, user_id: req.userId, action: isActive ? 'activate' : 'deactivate',
      entity_type: 'user', entity_id: id,
      description: `Usuário ${existing.name} ${isActive ? 'reativado' : 'desativado'}`,
    });
    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Erro ao alterar status do usuário:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/users/management/:id - Deletar usuário
router.delete('/:id', requireAdminOrManager, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    
    // Não pode deletar a si mesmo
    if (req.userId === id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Você não pode excluir seu próprio usuário' 
      });
    }
    
    // Verificar se o usuário pertence ao tenant
    const existingUser = await permissionModel.getUserById(id, tenantId);
    if (!existingUser) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    
    try { seats.assertNotProtected(existingUser, 'excluir'); }
    catch (e) { const r = seatErr(res, e); if (r) return r; throw e; }

    await permissionModel.deleteUser(id, tenantId);
    
    // Log de atividade
    await saasModel.createActivityLog({
      tenant_id: tenantId,
      user_id: req.userId,
      action: 'delete',
      entity_type: 'user',
      entity_id: id,
      description: `Usuário ${existingUser.name} excluído`
    });
    
    res.json({ success: true, message: 'Usuário deletado com sucesso' });
  } catch (err) {
    console.error('Erro ao deletar usuário:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

