/* =============================================================================
 * demo-server.js — Servidor de DEMONSTRAÇÃO (localhost) do MVP financeiro.
 *
 * Roda as ROTAS FINANCEIRAS REAIS contra um Postgres em memória (pg-mem),
 * com dados de exemplo semeados. Rotas não-financeiras são stubs simples para
 * o dashboard renderizar. NÃO usar em produção — é só para visualização local.
 *
 * Uso:  cd saas-multitenant/backend && node demo-server.js   (porta 5000)
 * ============================================================================= */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-secret';
process.env.NODE_ENV = 'development';

const path = require('path');
const { randomUUID } = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { newDb, DataType } = require('pg-mem');

const TENANT = 'demo-tenant';
const todayISO = () => new Date().toISOString().slice(0, 10);
const shiftISO = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

// ── 1) Postgres em memória + schema mínimo + financeiro ──────────────────────
const db = newDb();
db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });

db.public.none(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, slug TEXT, logo_url TEXT, brand_color TEXT, tagline TEXT);
  CREATE TABLE users (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, email TEXT, role TEXT);
  CREATE TABLE clients (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, cpf TEXT, phone TEXT, email TEXT, address TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE fines (id TEXT PRIMARY KEY, tenant_id TEXT, client_id TEXT, fine_number TEXT, plate TEXT, organ TEXT, stage TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE service_types (id INT PRIMARY KEY, code TEXT, label TEXT);

  CREATE TABLE financial_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
    name TEXT NOT NULL, type TEXT NOT NULL, description TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_financial_categories UNIQUE (tenant_id, type, name)
  );
  CREATE TABLE service_billings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
    client_id TEXT, company_id TEXT, fine_id TEXT, service_type_id INT, description TEXT,
    original_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount NUMERIC(15,2) NOT NULL DEFAULT 0,
    surcharge NUMERIC(15,2) NOT NULL DEFAULT 0, final_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    paid_amount NUMERIC(15,2) NOT NULL DEFAULT 0, installments INT NOT NULL DEFAULT 1,
    due_date DATE, payment_method TEXT, financial_status TEXT NOT NULL DEFAULT 'faturado',
    notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, billing_id UUID,
    client_id TEXT, fine_id TEXT, amount NUMERIC(15,2) NOT NULL, payment_date DATE,
    payment_method TEXT, status TEXT NOT NULL DEFAULT 'confirmado', installment_number INT DEFAULT 1,
    installments_total INT DEFAULT 1, is_deposit BOOLEAN DEFAULT FALSE, notes TEXT, created_by TEXT,
    canceled_at TIMESTAMPTZ, cancel_reason TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE financial_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, type TEXT NOT NULL,
    category_id UUID, description TEXT, amount NUMERIC(15,2) NOT NULL, transaction_date DATE,
    due_date DATE, payment_method TEXT, status TEXT NOT NULL DEFAULT 'pago', client_id TEXT, fine_id TEXT,
    billing_id UUID, payment_id UUID UNIQUE, origin TEXT NOT NULL DEFAULT 'manual', created_by TEXT,
    notes TEXT, canceled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, number INT NOT NULL,
    prefix TEXT NOT NULL DEFAULT 'NEXO', full_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'emitido',
    issue_date DATE, client_id TEXT, payment_id UUID, billing_id UUID, fine_id TEXT,
    client_name TEXT, client_document TEXT, service_description TEXT, amount NUMERIC(15,2) DEFAULT 0,
    payment_method TEXT, issuer_name TEXT, issuer_document TEXT, issuer_address TEXT, notes TEXT,
    created_by TEXT, created_by_name TEXT, canceled_at TIMESTAMPTZ, cancel_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_receipts_tenant_number UNIQUE (tenant_id, number)
  );
  CREATE TABLE tenant_financial_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL UNIQUE,
    receipt_prefix TEXT NOT NULL DEFAULT 'NEXO', last_receipt_number INT NOT NULL DEFAULT 0,
    razao_social TEXT, document TEXT, address TEXT, phone TEXT, email TEXT, logo_url TEXT,
    enabled_payment_methods JSONB NOT NULL DEFAULT '["pix","dinheiro","cartao_credito","cartao_debito","boleto","transferencia","outro"]',
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
`);

const pgAdapter = db.adapters.createPg();
const pool = new pgAdapter.Pool();

// ── 2) Injeta o pool do pg-mem no lugar de config/db (para as rotas reais) ────
const dbModulePath = require.resolve('./config/db');
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: pool };

// Agora sim: carrega as rotas/serviços reais (usarão o pool injetado).
const financialRoutes = require('./routes/financialRoutes');
const paymentService = require('./services/finance/paymentService');
const receiptService = require('./services/finance/receiptService');
const { createDbRepo } = require('./services/finance/financeRepo');
const categoryModel = require('./models/financialCategoryModels');

// ── 3) Seed de dados de demonstração ─────────────────────────────────────────
async function seed() {
  await pool.query(`INSERT INTO tenants (id,name,slug,brand_color,tagline) VALUES ($1,'Despachante Demo · Nexo','demo','#751518','Assessoria de Trânsito')`, [TENANT]);
  await pool.query(`INSERT INTO users (id,tenant_id,name,email,role) VALUES ('u-admin',$1,'Administrador Demo','admin@demo.com','admin')`, [TENANT]);
  await pool.query(`INSERT INTO service_types (id,code,label) VALUES (1,'MULTA','Auto de Infração'),(2,'SUSPENSAO','Suspensão')`);
  await pool.query(`INSERT INTO clients (id,tenant_id,name,cpf,phone,email,address,status) VALUES
    ('c1',$1,'Maria Oliveira','12345678909','(21) 99888-1122','maria@ex.com','Rua A, 100 - RJ','fechado'),
    ('c2',$1,'João Santos','98765432100','(21) 97777-3344','joao@ex.com','Av. B, 200 - RJ','negociacao'),
    ('c3',$1,'Transportes XYZ Ltda','11222333000181','(21) 96666-5566','contato@xyz.com','Rod. C, km 3 - RJ','fechado')`, [TENANT]);
  await pool.query(`INSERT INTO fines (id,tenant_id,client_id,fine_number,plate,organ,stage,status) VALUES
    ('f1',$1,'c1','AI-2026-0001','ABC1D23','DETRAN-RJ','defesa_previa','protocolado'),
    ('f2',$1,'c2','AI-2026-0002','EFG4H56','DER-RJ','recurso_1','pendente')`, [TENANT]);

  await categoryModel.ensureDefaultCategories(TENANT);
  const cat = (name, type) => pool.query(`SELECT id FROM financial_categories WHERE tenant_id=$1 AND name=$2 AND type=$3`, [TENANT, name, type]).then(r => r.rows[0].id);
  const catServico = await cat('Pagamento de serviço', 'entrada');
  const catParcela = await cat('Parcela', 'entrada');
  const catDespesa = await cat('Despesas administrativas', 'saida');

  // Faturamentos
  const b1 = (await pool.query(`INSERT INTO service_billings (tenant_id,client_id,fine_id,service_type_id,description,original_amount,discount,surcharge,final_amount,installments,due_date,payment_method,financial_status,created_by)
    VALUES ($1,'c1','f1',1,'Defesa prévia - Auto de Infração',900,100,0,800,1,$2,'pix','faturado','u-admin') RETURNING *`, [TENANT, shiftISO(5)])).rows[0];
  const b2 = (await pool.query(`INSERT INTO service_billings (tenant_id,client_id,fine_id,service_type_id,description,original_amount,discount,surcharge,final_amount,installments,due_date,payment_method,financial_status,created_by)
    VALUES ($1,'c2','f2',2,'Recurso 1ª instância - Suspensão',1200,0,0,1200,3,$2,'boleto','faturado','u-admin') RETURNING *`, [TENANT, shiftISO(-3)])).rows[0];
  await pool.query(`INSERT INTO service_billings (tenant_id,client_id,service_type_id,description,original_amount,final_amount,installments,due_date,payment_method,financial_status,created_by)
    VALUES ($1,'c3',1,'Assessoria mensal de frota',1500,1500,1,$2,'transferencia','faturado','u-admin')`, [TENANT, shiftISO(12)]);

  const repo = createDbRepo(pool);
  // Pagamento total do b1 (gera entrada + permite recibo)
  const p1 = await paymentService.confirmPayment({ tenant_id: TENANT, billing_id: b1.id, amount: 800, payment_date: todayISO(), payment_method: 'pix', category_id: catServico, entry_description: 'Recebimento - Maria Oliveira' }, repo);
  // Pagamento parcial (sinal) do b2
  await paymentService.confirmPayment({ tenant_id: TENANT, billing_id: b2.id, amount: 500, payment_date: shiftISO(-1), payment_method: 'boleto', is_deposit: true, installments_total: 3, installment_number: 1, category_id: catParcela, entry_description: 'Sinal - João Santos' }, repo);

  // Recibo do pagamento total
  await receiptService.issueReceipt({
    tenant_id: TENANT, payment_id: p1.payment.id, client_id: 'c1', fine_id: 'f1',
    client_name: 'Maria Oliveira', client_document: '123.456.789-09',
    service_description: 'Defesa prévia - Auto de Infração AI-2026-0001',
    amount: 800, payment_method: 'pix', created_by: 'u-admin', created_by_name: 'Administrador Demo',
    defaultIssuerName: 'Despachante Demo · Nexo', defaultPrefix: 'NEXO',
  }, repo);

  // Lançamentos manuais (Caixa desta semana)
  await pool.query(`INSERT INTO financial_transactions (tenant_id,type,category_id,description,amount,transaction_date,payment_method,status,origin,created_by)
    VALUES ($1,'saida',$2,'Aluguel do escritório',1200,$3,'transferencia','pago','manual','u-admin'),
           ($1,'entrada',$4,'Recebimento avulso - consultoria',350,$5,'dinheiro','recebido','manual','u-admin')`,
    [TENANT, catDespesa, todayISO(), catServico, shiftISO(-2)]);

  console.log('✓ Seed de demonstração concluído.');
}

// ── 4) App Express (auth demo + rotas financeiras reais + stubs) ─────────────
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const demoUser = { id: 'u-admin', name: 'Administrador Demo', email: 'admin@demo.com', role: 'admin' };
const demoTenant = { id: TENANT, name: 'Despachante Demo · Nexo', slug: 'demo', logo_url: null, brand_color: '#751518', brand_color_dark: '#050708', tagline: 'Assessoria de Trânsito' };

function makeToken() { return jwt.sign({ userId: 'u-admin', tenantId: TENANT, email: 'admin@demo.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' }); }

app.post('/auth/login', (req, res) => {
  const token = makeToken();
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.cookie('auth-token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, token, user: demoUser, tenant: demoTenant });
});
app.post('/auth/validate', (req, res) => res.json({ success: true, user: demoUser, tenant: { id: TENANT }, role: 'admin' }));
app.post('/auth/logout', (req, res) => res.json({ success: true }));

// tenantContext real protege /api
const tenantContext = require('./middlewares/tenantContext');
app.use('/api', tenantContext);

// Rotas financeiras REAIS (pg-mem)
app.use('/api/financial', financialRoutes);

// Stubs mínimos para o dashboard (dados de exemplo)
app.get('/api/clients', (req, res) => res.json({ success: true, data: [
  { id: 'c1', name: 'Maria Oliveira', cpf: '12345678909', status: 'fechado', phone: '(21) 99888-1122' },
  { id: 'c2', name: 'João Santos', cpf: '98765432100', status: 'negociacao', phone: '(21) 97777-3344' },
  { id: 'c3', name: 'Transportes XYZ Ltda', cpf: '11222333000181', status: 'fechado', phone: '(21) 96666-5566' },
] }));
app.get('/api/contracts/dashboard', (req, res) => res.json({ success: true, data: { dashboard: { total_contracts: 2, active_contracts: 2, deferred_count: 0, completed_contracts: 0 }, alerts: [{ type: 'warning', count: 1 }] } }));
app.get('/api/contracts/deferred', (req, res) => res.json({ success: true, data: [] }));
app.get('/api/contracts/stage-clients', (req, res) => res.json({ success: true, data: {} }));
app.get('/api/calendar-events/upcoming', (req, res) => res.json({ success: true, data: [] }));
app.get('/api/calendar-events', (req, res) => res.json({ success: true, data: [] }));
app.get('/api/multas-leads/kanban', (req, res) => res.json({ success: true, data: [] }));

// Catch-all para qualquer outro /api GET (evita 404 barulhento no dashboard)
app.get('/api/*', (req, res) => res.json({ success: true, data: [] }));

app.use((req, res) => res.status(404).json({ success: false, error: 'Rota não encontrada (demo)' }));

const PORT = process.env.PORT || 5000;
seed()
  .then(() => app.listen(PORT, () => console.log(`\n🟢 DEMO backend on http://localhost:${PORT}  (tenant=${TENANT}, login: admin@demo.com / qualquer senha)\n`)))
  .catch((err) => { console.error('Falha no seed:', err); process.exit(1); });
