require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: __dirname + '/.env' });

const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const tenantContext = require('./middlewares/tenantContext');
const pool = require('./config/db');
const log = require('./services/logger');
const health = require('./services/health');
const crypto = require('crypto');

const authRoutes = require('./routes/authRoutes');
const leadsRoutes = require('./routes/leadsRoutes');
const assetRoutes = require('./routes/assetsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const targetsRoutes = require('./routes/targetsRoutes');
const sellersRoutes = require('./routes/sellersRoutes');
const forecastRoutes = require('./routes/forecastRoutes');
const clientRoutes = require('./routes/clientRoutes');
const contractRoutes = require('./routes/contractRoutes');
const documentRoutes = require('./routes/documentRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const saasRoutes = require('./routes/saasRoutes');
const userManagementRoutes = require('./routes/userManagementRoutes');
const finesRoutes = require('./routes/finesRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const multasLeadsRoutes = require('./routes/multasLeadsRoutes');
const uploadRoutes        = require('./routes/uploadRoutes');
const fineProtocolRoutes  = require('./routes/fineProtocolRoutes');
const approvalRoutes      = require('./routes/approvalRoutes');
const companyRoutes       = require('./routes/companyRoutes');
const calendarEventRoutes = require('./routes/calendarEventRoutes');
const masterRoutes        = require('./routes/masterRoutes');
const financialRoutes     = require('./routes/financialRoutes');
// LocaCore — Frota (vehicles) e Locações (rentals)
const vehicleRoutes       = require('./routes/vehicleRoutes');
const rentalRoutes        = require('./routes/rentalRoutes');
const configOptionRoutes  = require('./routes/configOptionRoutes');
const maintenanceRoutes   = require('./routes/maintenanceRoutes');
const rentalFineRoutes    = require('./routes/rentalFineRoutes');
const inventoryRoutes     = require('./routes/inventoryRoutes');
const reportRoutes        = require('./routes/reportRoutes');
const importRoutes        = require('./routes/importRoutes');
const automationRoutes    = require('./routes/automationRoutes');
const automationWebhookRoutes = require('./routes/automationWebhookRoutes');

const app = express();

// Confia no proxy reverso (Nginx) para X-Forwarded-For e X-Forwarded-Proto
// Necessário para rate-limit e cookies secure funcionarem corretamente atrás do Nginx
app.set('trust proxy', 1);

// ============================================
// CORS
// ============================================

// Em produção, defina FRONTEND_URL no .env com o domínio real
const FRONTEND_URL = process.env.FRONTEND_URL || '';

// Origens liberadas no CORS. Em produção, defina FRONTEND_URL com o domínio do
// frontend do LocaCore (Vercel). Sem branding/domínios de sistemas anteriores.
const EXTRA_ORIGINS = (process.env.EXTRA_CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  ...(FRONTEND_URL ? [FRONTEND_URL.trim()] : []),
  ...EXTRA_ORIGINS,
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================
// SECURITY HEADERS
// ============================================

const connectSrcDirectives = ["'self'", ...(FRONTEND_URL ? [FRONTEND_URL] : [])];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: connectSrcDirectives,
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

//  Remove header que revela tecnologia
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.set('Cache-Control', 'no-store');
  next();
});

// ============================================
// RATE LIMIT GLOBAL
// ============================================

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,                  // 200 requests por IP
  message: { success: false, message: 'Muitas requisições. Tente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Webhooks EXTERNOS (pagamento/WhatsApp): montados ANTES do express.json para
// preservar o CORPO BRUTO (necessário para validar a assinatura HMAC). Fora de
// /api → sem JWT; segurança por assinatura + idempotência.
app.use('/webhooks', automationWebhookRoutes);

// ============================================
// MIDDLEWARES
// ============================================

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Log estruturado por requisição (request_id + duração + tenant). Sem secrets.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    // Não loga assets estáticos nem health (ruído).
    if (req.path.startsWith('/uploads') || req.path.startsWith('/health')) return;
    log.info('http', {
      request_id: req.id, method: req.method, path: req.path, status: res.statusCode,
      duration_ms: Date.now() - started, tenant_id: req.tenantId || null, user_id: req.userId || null,
    });
  });
  next();
});

// ============================================
// ROTAS
// ============================================

app.use('/auth', authRoutes);

// Serve arquivos de upload estaticamente (sem autenticação — URL contém tenantId no path)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  setHeaders: (res) => {
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
  },
}));

app.use('/api', tenantContext);

app.use('/api/leads', leadsRoutes);
app.use('/api/targets', targetsRoutes);
app.use('/api/sellers', sellersRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api', saasRoutes);
app.use('/api/fines', finesRoutes);
app.use('/api/users/management', userManagementRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/multas-leads', multasLeadsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/fine-protocols', fineProtocolRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/calendar-events', calendarEventRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/financial', financialRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/config-options', configOptionRoutes);
app.use('/api/maintenances', maintenanceRoutes);
app.use('/api/rental-fines', rentalFineRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/import', importRoutes);
app.use('/api/automations', automationRoutes);

// ============================================
// HEALTH CHECK (sem autenticação — para uptime monitors)
// ============================================

// Liveness: o processo está vivo (não toca no banco).
app.get('/health/live', (req, res) => res.json({ status: 'live', uptime: process.uptime() }));

// Readiness: banco + heartbeats de worker/scheduler + backlog da fila (informativo).
app.get('/health/ready', async (req, res) => {
  const r = await health.ready();
  res.status(r.ok ? 200 : 503).json({ status: r.ok ? 'ready' : 'degraded', ...r });
});

// Compatibilidade: /health simples (uptime monitors antigos).
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ============================================
// 404
// ============================================

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Rota não encontrada' });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR]', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: 'Erro interno do servidor',
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5000;

// Handlers de crash para evitar queda silenciosa em produção
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err.message, err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection:', reason);
  process.exit(1);
});

(async () => {
  try {
    await pool.query('SELECT NOW()');
    console.log(' Conectado ao Banco de Dados');
  } catch (err) {
    console.error(' Erro ao conectar no banco:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`LocaCore API rodando na porta ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
})();