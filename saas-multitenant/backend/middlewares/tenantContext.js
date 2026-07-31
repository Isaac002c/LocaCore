// middlewares/tenantContext.js
const jwt = require('jsonwebtoken');

const isDev = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (isDev) console.log(...args); };

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não definido nas variáveis de ambiente');
  return secret;
};

// Cache curto do estado de acesso do usuário (§9/§10). Evita consultar o banco a
// cada requisição, mas mantém a desativação/reset de sessão efetivos em ~TTL.
const AUTH_TTL_MS = 15000;
const authCache = new Map(); // userId → { at, is_active, sessions_valid_after }

// Verifica se o usuário ainda pode acessar: ativo e com token emitido após o
// último reset de sessão. Retorna string de motivo p/ bloquear, ou null p/ permitir.
async function accessDenialReason(userId, tenantId, iatSeconds) {
  let state = authCache.get(userId);
  if (!state || Date.now() - state.at > AUTH_TTL_MS) {
    try {
      // require tardio: evita ciclo e mantém o middleware carregável sem o modelo.
      const permissionModel = require('../models/permissionModels');
      const row = await permissionModel.getUserAuthState(userId, tenantId);
      if (!row) return 'Usuário não encontrado.'; // deletado → sem acesso
      state = { at: Date.now(), is_active: row.is_active !== false, sessions_valid_after: row.sessions_valid_after || null };
      authCache.set(userId, state);
    } catch (err) {
      // Fail-open (preserva disponibilidade; o login já bloqueia novas sessões).
      log('[tenantContext] enforcement indisponível:', err.message);
      return null;
    }
  }
  if (!state.is_active) return 'Usuário desativado.';
  if (state.sessions_valid_after && iatSeconds) {
    // Comparar na MESMA resolução dos dois lados.
    //
    // `iat` do JWT é em SEGUNDOS inteiros (truncado); `sessions_valid_after` é
    // timestamptz com MILISSEGUNDOS. Comparar `iat*1000 < sva` recusava um token
    // recém-emitido e legítimo: trocar a senha às 12:00:00.300 e logar às
    // 12:00:00.800 gera iat=12:00:00.000, que é "menor" que 12:00:00.300 — o
    // login dava 200 e a requisição seguinte, 401.
    //
    // Truncando `sessions_valid_after` para o segundo, um token emitido no mesmo
    // segundo da invalidação continua valendo (janela ≤ 1s, limite inerente ao
    // JWT) e qualquer token de um segundo anterior segue bloqueado.
    const invalidadoEmSegundos = Math.floor(new Date(state.sessions_valid_after).getTime() / 1000);
    if (invalidadoEmSegundos > iatSeconds) return 'Sessão expirada. Faça login novamente.';
  }
  return null;
}

// Descarta o estado em cache de um usuário — usado após trocar senha, desativar
// ou excluir, para o bloqueio valer na hora em vez de esperar o TTL.
function invalidateAuthCache(userId) {
  if (userId) authCache.delete(String(userId));
  else authCache.clear();
}

const tenantContext = async function tenantContext(req, res, next) {
  try {
    let token = null;

    // 1️⃣ Header Authorization
    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    // 2️⃣ Cookies
    else if (req.cookies?.token) {
      token = req.cookies.token;
    }
    else if (req.cookies?.['auth-token']) {
      token = req.cookies['auth-token'];
    }

  
    // Nunca aceitar token em URL — aparece em logs de servidor, histórico do browser, analytics

    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido.' });
    }

    // 3️⃣ Verifica token
    let decoded;
    try {
      decoded = jwt.verify(token, getJWTSecret());
    } catch (err) {

      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expirado.' });
      }
      return res.status(401).json({ error: 'Token inválido.' });
    }

    // 4️⃣ Valida tenantId
    if (!decoded.tenantId) {
      return res.status(401).json({ error: 'Tenant inválido.' });
    }

    // 5️⃣ Popula request
    req.tenantId  = String(decoded.tenantId);
    req.userId    = decoded.userId   || null;
    req.userEmail = decoded.email    || null;
    req.userRole  = decoded.role     || 'seller';
    req.sellerId  = decoded.sellerId || null;

    // 6️⃣ Enforcement de acesso (desativação/reset de sessão), exceto super_admin.
    if (req.userId && req.userRole !== 'super_admin') {
      const reason = await accessDenialReason(req.userId, req.tenantId, decoded.iat);
      if (reason) return res.status(401).json({ error: reason });
    }

    log('[tenantContext] Autenticado:', {
      userId:   req.userId,
      tenantId: req.tenantId,
      role:     req.userRole,
    });

    next();

  } catch (error) {
    console.error('[tenantContext] Erro inesperado:', error.message);
    return res.status(500).json({ error: 'Erro interno no middleware.' });
  }
};

module.exports = tenantContext;
module.exports.invalidateAuthCache = invalidateAuthCache;
