// middlewares/checkPermission.js
// Middleware para verificar permissões do usuário

// Definição de permissões por role
const rolePermissions = {
  admin: [
    'users:create', 'users:read', 'users:update', 'users:delete',
    'clients:create', 'clients:read', 'clients:update', 'clients:delete',
    'companies:create', 'companies:read', 'companies:update', 'companies:delete',
    'contracts:create', 'contracts:read', 'contracts:update', 'contracts:delete',
    'documents:create', 'documents:read', 'documents:update', 'documents:delete',
    'fines:create', 'fines:read', 'fines:update', 'fines:delete',
    'reports:read', 'reports:export',
    'settings:read', 'settings:update',
    'billing:read', 'billing:update',
    // Módulo Financeiro (enforcement real em middlewares/financeAccess.js).
    // Admin tem acesso completo; consultor/seller/super_admin não recebem estas permissões.
    'finance:read', 'finance:manage'
  ],
  manager: [
    'clients:create', 'clients:read', 'clients:update',
    'companies:create', 'companies:read', 'companies:update',
    'contracts:create', 'contracts:read', 'contracts:update',
    'documents:create', 'documents:read', 'documents:update',
    'fines:create', 'fines:read', 'fines:update', 'fines:delete',
    'reports:read', 'reports:export'
  ],
  operator: [
    'clients:create', 'clients:read', 'clients:update',
    'companies:create', 'companies:read', 'companies:update',
    'contracts:create', 'contracts:read', 'contracts:update',
    'documents:create', 'documents:read',
    'fines:create', 'fines:read', 'fines:update'
  ],
  seller: [
    'clients:create', 'clients:read', 'clients:update',
    'companies:create', 'companies:read', 'companies:update',
    'contracts:create', 'contracts:read', 'contracts:update',
    'documents:create', 'documents:read',
    'fines:create', 'fines:read', 'fines:update'
  ],
  viewer: [
    'clients:read',
    'companies:read',
    'contracts:read',
    'documents:read',
    'fines:read',
    'reports:read'
  ]
};

/**
 * Middleware para verificar se o usuário tem uma permissão específica
 * @param {string} permission - Permissão necessária (ex: 'contracts:create')
 */
const checkPermission = (permission) => {
  return (req, res, next) => {
    try {
      const userRole = req.userRole || 'viewer';
      
      // Admin tem acesso a tudo
      if (userRole === 'admin') {
        return next();
      }
      
      // Verificar se a role existe
      const permissions = rolePermissions[userRole] || [];
      
      // Verificar permissão específica
      if (!permissions.includes(permission)) {
        console.warn(`[Permission] Usuário role=${userRole} tentou acessar ${permission}`);
        return res.status(403).json({ 
          success: false, 
          error: 'Você não tem permissão para realizar esta ação' 
        });
      }
      
      next();
    } catch (error) {
      console.error('[Permission] Erro ao verificar permissão:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Erro ao verificar permissão' 
      });
    }
  };
};

/**
 * Middleware para verificar se o usuário é admin ou manager
 */
const requireAdminOrManager = (req, res, next) => {
  const userRole = req.userRole || 'viewer';
  
  if (userRole === 'admin' || userRole === 'manager') {
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    error: 'Acesso restrito a administradores e gerentes' 
  });
};

/**
 * Middleware para verificar se o usuário é admin
 */
const requireAdmin = (req, res, next) => {
  const userRole = req.userRole || 'viewer';
  
  if (userRole === 'admin') {
    return next();
  }
  
  return res.status(403).json({ 
    success: false, 
    error: 'Acesso restrito a administradores' 
  });
};

/**
 * Retorna as permissões de uma role
 */
const getPermissionsByRole = (role) => {
  return rolePermissions[role] || [];
};

/**
 * Retorna todas as roles disponíveis
 */
const getAllRoles = () => {
  return Object.keys(rolePermissions);
};

module.exports = {
  checkPermission,
  requireAdminOrManager,
  requireAdmin,
  getPermissionsByRole,
  getAllRoles,
  rolePermissions
};

