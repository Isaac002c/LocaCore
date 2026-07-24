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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, slug TEXT, logo_url TEXT, brand_color TEXT, tagline TEXT, modules JSONB);
  CREATE TABLE users (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, email TEXT, role TEXT);
  CREATE TABLE clients (id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT, birth_date DATE, cpf TEXT, cnh TEXT, first_cnh DATE, phone TEXT, email TEXT, address TEXT, notes TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, contract_id UUID, client_id TEXT, company_id UUID, vehicle_id UUID, rental_id UUID, vehicle_asset_id UUID, file_url TEXT, file_name TEXT, file_type TEXT, file_size BIGINT, category TEXT DEFAULT 'outros', description TEXT, uploaded_by TEXT, uploaded_at TIMESTAMPTZ DEFAULT now());
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
    issue_date DATE, client_id TEXT, payment_id UUID, billing_id UUID, fine_id TEXT, rental_id UUID,
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

  -- LocaCore: Frota + Locações (para demonstração local do módulo de locadora)
  CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL,
    plate TEXT, brand TEXT, model TEXT, year INT, color TEXT, category TEXT, renavam TEXT, chassi TEXT,
    fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, odometer INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'disponivel', notes TEXT, created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE rentals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT,
    client_id TEXT, vehicle_id UUID, status TEXT NOT NULL DEFAULT 'reservado',
    start_date DATE, end_date DATE, return_date DATE,
    daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, days INT NOT NULL DEFAULT 1,
    extras_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, deposit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT,
    notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE service_billings ADD COLUMN rental_id UUID;
  CREATE TABLE tenant_config_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE rental_extras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID NOT NULL,
    category TEXT, description TEXT, quantity NUMERIC(12,2) NOT NULL DEFAULT 1, unit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, extra_date DATE, status TEXT NOT NULL DEFAULT 'ativo', created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  -- Ciclo 5 (multas locadora, estoque, calendário, vistoria, usuários)
  ALTER TABLE rentals ADD COLUMN pickup_inspection JSONB;
  ALTER TABLE rentals ADD COLUMN return_inspection JSONB;
  ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN sessions_valid_after TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
  ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  CREATE TABLE rental_fines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, vehicle_id UUID, client_id TEXT,
    driver_name TEXT, fine_number TEXT, organ TEXT, infraction_date DATE, notification_date DATE, due_date DATE,
    original_amount NUMERIC(15,2) DEFAULT 0, admin_fee NUMERIC(15,2) DEFAULT 0, total_amount NUMERIC(15,2) DEFAULT 0,
    points INT DEFAULT 0, description TEXT, notes TEXT, status TEXT DEFAULT 'identificada',
    responsible_user_id TEXT, billing_id UUID, rental_extra_id UUID, created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT NOT NULL, code TEXT, category TEXT,
    unit TEXT DEFAULT 'un', description TEXT, quantity NUMERIC(15,3) DEFAULT 0, min_quantity NUMERIC(15,3) DEFAULT 0,
    unit_cost NUMERIC(15,2) DEFAULT 0, location TEXT, active BOOLEAN DEFAULT TRUE, created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, item_id UUID NOT NULL, type TEXT NOT NULL,
    quantity NUMERIC(15,3) NOT NULL, unit_cost NUMERIC(15,2) DEFAULT 0, balance_after NUMERIC(15,3) DEFAULT 0,
    reason TEXT, movement_date DATE DEFAULT CURRENT_DATE, vehicle_id UUID, rental_id UUID, maintenance_id UUID,
    supplier TEXT, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE storage_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, provider TEXT DEFAULT 'local', bucket TEXT,
    object_key TEXT NOT NULL, category TEXT, entity_type TEXT, entity_id UUID, file_name TEXT, content_type TEXT,
    size BIGINT, checksum TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, title TEXT, description TEXT,
    event_date DATE, start_time TIME, end_time TIME, type TEXT DEFAULT 'outro', status TEXT DEFAULT 'agendado',
    priority TEXT, client_id TEXT, fine_id UUID, service_type_id INT, responsible_user_id TEXT,
    rental_id UUID, vehicle_id UUID, maintenance_id UUID, value NUMERIC(15,2),
    payment_method TEXT, attendee_cpf TEXT, attendee_cnh TEXT, attendee_first_cnh DATE, attendee_birth_date DATE,
    attendee_phone TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE rental_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID NOT NULL,
    version INT DEFAULT 1, number TEXT, snapshot JSONB DEFAULT '{}', status TEXT DEFAULT 'gerado',
    created_by TEXT, created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE tenant_contract_settings (
    tenant_id TEXT PRIMARY KEY, header TEXT, clauses TEXT, footer TEXT, updated_at TIMESTAMPTZ DEFAULT now()
  );
  -- Automação (Ciclo 3)
  CREATE TABLE automation_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL UNIQUE,
    billing_enabled BOOLEAN NOT NULL DEFAULT FALSE, billing_weekday INT NOT NULL DEFAULT 3, billing_hour INT NOT NULL DEFAULT 9,
    billing_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo', billing_due_days INT NOT NULL DEFAULT 3,
    billing_rental_statuses JSONB NOT NULL DEFAULT '["em_andamento","atrasado"]', billing_auto_create BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE, whatsapp_provider TEXT NOT NULL DEFAULT 'null', whatsapp_from TEXT, whatsapp_account_id TEXT,
    whatsapp_send_start_hour INT NOT NULL DEFAULT 8, whatsapp_send_end_hour INT NOT NULL DEFAULT 20,
    reminder_max INT NOT NULL DEFAULT 7, reminder_interval_hours INT NOT NULL DEFAULT 24, reminder_per_day INT NOT NULL DEFAULT 1,
    payment_provider TEXT NOT NULL DEFAULT 'null',
    fiscal_enabled BOOLEAN NOT NULL DEFAULT FALSE, fiscal_mode TEXT NOT NULL DEFAULT 'after_payment', fiscal_provider TEXT NOT NULL DEFAULT 'null',
    fiscal_document_type TEXT, fiscal_environment TEXT NOT NULL DEFAULT 'homologacao', fiscal_config JSONB NOT NULL DEFAULT '{}',
    cost_per_message NUMERIC(15,4) NOT NULL DEFAULT 0, cost_per_fiscal NUMERIC(15,4) NOT NULL DEFAULT 0,
    cost_currency TEXT NOT NULL DEFAULT 'BRL', cost_monthly_limit NUMERIC(15,2),
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE message_templates ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, language TEXT DEFAULT 'pt_BR', body TEXT NOT NULL, variables JSONB DEFAULT '[]', provider_template_id TEXT, approval_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
  CREATE TABLE charges ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, billing_id UUID, client_id TEXT, provider TEXT DEFAULT 'null', external_id TEXT, amount NUMERIC(15,2) DEFAULT 0, due_date DATE, status TEXT DEFAULT 'pending', pix_code TEXT, payment_link TEXT, expires_at TIMESTAMPTZ, period_start DATE, period_end DATE, idempotency_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT uq_charges_idem UNIQUE (tenant_id, idempotency_key) );
  CREATE TABLE message_outbox ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id TEXT, rental_id UUID, charge_id UUID, template_kind TEXT NOT NULL, to_number TEXT, body TEXT, payload JSONB DEFAULT '{}', status TEXT DEFAULT 'pending', attempts INT DEFAULT 0, max_attempts INT DEFAULT 5, next_attempt_at TIMESTAMPTZ, provider TEXT, external_id TEXT, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, error TEXT, cost_amount NUMERIC(15,4) DEFAULT 0, idempotency_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT uq_outbox_idem UNIQUE (tenant_id, idempotency_key) );
  CREATE TABLE fiscal_documents ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, client_id TEXT, billing_id UUID, payment_id UUID, provider TEXT DEFAULT 'null', external_id TEXT, document_type TEXT, number TEXT, series TEXT, verification_code TEXT, amount NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'pending_configuration', issue_date TIMESTAMPTZ, authorization_date TIMESTAMPTZ, cancellation_date TIMESTAMPTZ, pdf_url TEXT, xml_url TEXT, error_code TEXT, error_message TEXT, retry_count INT DEFAULT 0, idempotency_key TEXT NOT NULL, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT uq_fiscal_idem UNIQUE (tenant_id, idempotency_key) );
  CREATE TABLE automation_runs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, run_type TEXT NOT NULL, period_start DATE, period_end DATE, status TEXT DEFAULT 'running', rentals_processed INT DEFAULT 0, charges_created INT DEFAULT 0, messages_enqueued INT DEFAULT 0, details JSONB DEFAULT '{}', idempotency_key TEXT NOT NULL, started_at TIMESTAMPTZ DEFAULT now(), finished_at TIMESTAMPTZ, CONSTRAINT uq_runs_idem UNIQUE (tenant_id, idempotency_key) );
  CREATE TABLE external_costs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id UUID, provider TEXT, quantity INT DEFAULT 1, unit_cost NUMERIC(15,4) DEFAULT 0, amount NUMERIC(15,4) DEFAULT 0, currency TEXT DEFAULT 'BRL', cost_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT now() );
  CREATE TABLE webhook_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, provider TEXT NOT NULL, kind TEXT NOT NULL, external_event_id TEXT NOT NULL, received_at TIMESTAMPTZ DEFAULT now(), CONSTRAINT uq_webhook_event UNIQUE (provider, external_event_id) );
  CREATE TABLE vehicle_maintenances ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, vehicle_id UUID NOT NULL, type TEXT, status TEXT DEFAULT 'agendada', scheduled_date DATE, done_date DATE, odometer_scheduled INT, odometer_done INT, cost NUMERIC(15,2) DEFAULT 0, supplier TEXT, notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now() );
  CREATE TABLE job_locks ( name TEXT PRIMARY KEY, owner TEXT NOT NULL, acquired_at TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL );
  CREATE TABLE system_heartbeats ( service TEXT PRIMARY KEY, last_beat TIMESTAMPTZ DEFAULT now(), meta JSONB DEFAULT '{}' );
`);

const pgAdapter = db.adapters.createPg();
const pool = new pgAdapter.Pool();

// ── 2) Injeta o pool do pg-mem no lugar de config/db (para as rotas reais) ────
const dbModulePath = require.resolve('./config/db');
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: pool };

// Agora sim: carrega as rotas/serviços reais (usarão o pool injetado).
const financialRoutes = require('./routes/financialRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const rentalRoutes = require('./routes/rentalRoutes');
const paymentService = require('./services/finance/paymentService');
const receiptService = require('./services/finance/receiptService');
const { createDbRepo } = require('./services/finance/financeRepo');
const categoryModel = require('./models/financialCategoryModels');
const vehicleModel = require('./models/vehicleModels');
const rentalModel = require('./models/rentalModels');

// ── 3) Seed de dados de demonstração ─────────────────────────────────────────
async function seed() {
  await pool.query(`INSERT INTO tenants (id,name,slug,brand_color,tagline,modules) VALUES ($1,'Locadora Demo','demo','#1d4ed8','Locação de Veículos','["locacao","financeiro"]')`, [TENANT]);
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

  // ── LocaCore: frota + locações de exemplo ──────────────────────────────────
  const v1 = await vehicleModel.createVehicle({ tenant_id: TENANT, plate: 'RIO2A18', brand: 'Fiat', model: 'Argo', year: 2023, color: 'Prata', category: 'Hatch', fuel: 'Flex', transmission: 'manual', daily_rate: 120, odometer: 32000, status: 'disponivel' });
  const v2 = await vehicleModel.createVehicle({ tenant_id: TENANT, plate: 'RIO3B29', brand: 'Chevrolet', model: 'Onix', year: 2024, color: 'Branco', category: 'Sedan', fuel: 'Flex', transmission: 'automatico', daily_rate: 150, odometer: 12000, status: 'disponivel' });
  await vehicleModel.createVehicle({ tenant_id: TENANT, plate: 'RIO4C30', brand: 'Toyota', model: 'Corolla', year: 2022, color: 'Preto', category: 'Sedan', fuel: 'Flex', transmission: 'automatico', daily_rate: 220, odometer: 58000, status: 'manutencao' });

  const r1 = await rentalModel.createRental({ tenant_id: TENANT, client_id: 'c1', vehicle_id: v1.id, start_date: shiftISO(-2), end_date: shiftISO(3), daily_rate: 120, deposit_amount: 400, status: 'em_andamento', created_by: 'u-admin' });
  await vehicleModel.setVehicleStatus(v1.id, 'alugado', TENANT);
  await rentalModel.createRental({ tenant_id: TENANT, client_id: 'c2', vehicle_id: v2.id, start_date: shiftISO(2), end_date: shiftISO(6), daily_rate: 150, deposit_amount: 500, status: 'reservado', created_by: 'u-admin' });
  // Faturamento vinculado à locação em andamento (integração financeira)
  const svc = require('./models/serviceBillingModels');
  await svc.createBilling({ tenant_id: TENANT, client_id: 'c1', rental_id: r1.id, description: `Locação ${r1.rental_number} — RIO2A18`, original_amount: r1.total_amount, discount: 0, surcharge: 0, final_amount: r1.total_amount, financial_status: 'faturado', created_by: 'u-admin' });

  // Automação (Ciclo 3): habilita cobrança/WhatsApp em modo sandbox para demo.
  const automationModels = require('./models/automationModels');
  await automationModels.updateSettings(TENANT, {
    billing_enabled: true, whatsapp_enabled: true, billing_auto_create: true,
    whatsapp_send_start_hour: 0, whatsapp_send_end_hour: 24, cost_per_message: 0.05, reminder_max: 3,
  });

  console.log('✓ Seed de demonstração concluído.');
}

// ── 4) App Express (auth demo + rotas financeiras reais + stubs) ─────────────
const app = express();
// Webhooks antes do express.json (corpo bruto para assinatura).
app.use('/webhooks', require('./routes/automationWebhookRoutes'));
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const demoUser = { id: 'u-admin', name: 'Administrador Demo', email: 'admin@demo.com', role: 'admin' };
// Tenant de demonstração = uma locadora. `modules` habilita as áreas LocaCore +
// Financeiro (parametrização por tenant, §2.3/§12).
const demoTenant = { id: TENANT, name: 'Locadora Demo', slug: 'demo', logo_url: null, brand_color: '#1d4ed8', brand_color_dark: '#0b1220', tagline: 'Locação de Veículos', modules: ['locacao', 'financeiro'] };

function makeToken() { return jwt.sign({ userId: 'u-admin', tenantId: TENANT, email: 'admin@demo.com', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' }); }

app.post('/auth/login', (req, res) => {
  const token = makeToken();
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.cookie('auth-token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ success: true, token, user: demoUser, tenant: demoTenant });
});
app.post('/auth/validate', (req, res) => res.json({ success: true, user: demoUser, tenant: { id: TENANT }, role: 'admin' }));
app.post('/auth/logout', (req, res) => res.json({ success: true }));

// Webhooks externos (fora de /api → sem JWT)
// tenantContext real protege /api
const tenantContext = require('./middlewares/tenantContext');
app.use('/api', tenantContext);

// Rotas REAIS (pg-mem) — financeiro + LocaCore (frota/locações).
// Montadas ANTES do catch-all de stubs para terem precedência.
app.use('/api/financial', financialRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/rentals', rentalRoutes);
app.use('/api/config-options', require('./routes/configOptionRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/documents', require('./routes/documentRoutes'));
app.use('/api/maintenances', require('./routes/maintenanceRoutes'));
app.use('/api/automations', require('./routes/automationRoutes'));
app.use('/api/rental-fines', require('./routes/rentalFineRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/calendar-events', require('./routes/calendarEventRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/users/management', require('./routes/userManagementRoutes'));
app.use('/api/import', require('./routes/importRoutes'));

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
