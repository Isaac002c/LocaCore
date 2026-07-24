'use strict';
// =============================================================================
// LOCACORE — Ciclo 3 (Automação): cobrança semanal idempotente, outbox (envio
// sandbox + custo), régua de inadimplência, confirmação de pagamento por webhook
// (idempotente, para lembretes, reusa o financeiro real), fiscal parametrizado
// (sem provedor → pending_configuration) e custos externos. pg-mem, sem rede.
// =============================================================================
process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/db?sslmode=disable';

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { newDb, DataType } = require('pg-mem');

let pool, M, rentalModel, vehicleModel, billing, dunning, outbox, payConfirm, fiscalService;
const T = 'tenant-1', T2 = 'tenant-2';
let cli, veh, rental;

before(async () => {
  const db = newDb();
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, impure: true, implementation: () => randomUUID() });

  db.public.none(`
    CREATE TABLE tenants ( id TEXT PRIMARY KEY, name TEXT, modules JSONB );
    CREATE TABLE users   ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, name TEXT );
    CREATE TABLE clients ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, name TEXT, cpf TEXT, phone TEXT );
    CREATE TABLE vehicles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, plate TEXT, brand TEXT, model TEXT, year INT, color TEXT,
      category TEXT, renavam TEXT, chassi TEXT, fuel TEXT, transmission TEXT, daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
      odometer INT NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'disponivel', notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE rentals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_number TEXT, client_id UUID, vehicle_id UUID,
      status TEXT NOT NULL DEFAULT 'reservado', start_date DATE, end_date DATE, return_date DATE,
      daily_rate NUMERIC(15,2) NOT NULL DEFAULT 0, days INT NOT NULL DEFAULT 1,
      extras_amount NUMERIC(15,2) NOT NULL DEFAULT 0, discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0, deposit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      pickup_odometer INT, return_odometer INT, pickup_location TEXT, return_location TEXT, pickup_inspection JSONB, return_inspection JSONB, notes TEXT, created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE service_billings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id UUID, company_id UUID, fine_id UUID, rental_id UUID,
      service_type_id INT, description TEXT, original_amount NUMERIC(15,2) DEFAULT 0, discount NUMERIC(15,2) DEFAULT 0,
      surcharge NUMERIC(15,2) DEFAULT 0, final_amount NUMERIC(15,2) DEFAULT 0, paid_amount NUMERIC(15,2) DEFAULT 0,
      installments INT DEFAULT 1, due_date DATE, payment_method TEXT, financial_status TEXT DEFAULT 'faturado',
      notes TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, billing_id UUID, client_id UUID, fine_id UUID, rental_id UUID,
      amount NUMERIC(15,2) NOT NULL, payment_date DATE, payment_method TEXT, status TEXT NOT NULL DEFAULT 'confirmado',
      installment_number INT DEFAULT 1, installments_total INT DEFAULT 1, is_deposit BOOLEAN DEFAULT FALSE, notes TEXT, created_by TEXT,
      canceled_at TIMESTAMPTZ, cancel_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE financial_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, type TEXT NOT NULL, category_id UUID, description TEXT,
      amount NUMERIC(15,2) NOT NULL, transaction_date DATE, due_date DATE, payment_method TEXT, status TEXT NOT NULL DEFAULT 'recebido',
      client_id UUID, fine_id UUID, billing_id UUID, payment_id UUID UNIQUE, origin TEXT DEFAULT 'manual', created_by TEXT,
      notes TEXT, canceled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE activity_logs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, user_id UUID, entity TEXT, entity_id UUID, entity_name TEXT, action TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE fines ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, fine_number TEXT, plate TEXT );
    CREATE TABLE service_types ( id INT PRIMARY KEY, code TEXT, label TEXT );
    CREATE TABLE receipts ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, payment_id UUID, status TEXT DEFAULT 'emitido', full_number TEXT );
    -- Automação
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
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE message_templates ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT, language TEXT DEFAULT 'pt_BR', body TEXT NOT NULL, variables JSONB DEFAULT '[]', provider_template_id TEXT, approval_status TEXT DEFAULT 'approved', active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE charges ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, billing_id UUID, client_id UUID, provider TEXT DEFAULT 'null', external_id TEXT, amount NUMERIC(15,2) DEFAULT 0, due_date DATE, status TEXT DEFAULT 'pending', pix_code TEXT, payment_link TEXT, expires_at TIMESTAMPTZ, period_start DATE, period_end DATE, idempotency_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_charges_idem UNIQUE (tenant_id, idempotency_key) );
    CREATE TABLE message_outbox ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, client_id UUID, rental_id UUID, charge_id UUID, template_kind TEXT NOT NULL, to_number TEXT, body TEXT, payload JSONB DEFAULT '{}', status TEXT DEFAULT 'pending', attempts INT DEFAULT 0, max_attempts INT DEFAULT 5, next_attempt_at TIMESTAMPTZ, provider TEXT, external_id TEXT, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, error TEXT, cost_amount NUMERIC(15,4) DEFAULT 0, idempotency_key TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_outbox_idem UNIQUE (tenant_id, idempotency_key) );
    CREATE TABLE fiscal_documents ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, rental_id UUID, client_id UUID, billing_id UUID, payment_id UUID, provider TEXT DEFAULT 'null', external_id TEXT, document_type TEXT, number TEXT, series TEXT, verification_code TEXT, amount NUMERIC(15,2) DEFAULT 0, status TEXT DEFAULT 'pending_configuration', issue_date TIMESTAMPTZ, authorization_date TIMESTAMPTZ, cancellation_date TIMESTAMPTZ, pdf_url TEXT, xml_url TEXT, error_code TEXT, error_message TEXT, retry_count INT DEFAULT 0, idempotency_key TEXT NOT NULL, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_fiscal_idem UNIQUE (tenant_id, idempotency_key) );
    CREATE TABLE automation_runs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, run_type TEXT NOT NULL, period_start DATE, period_end DATE, status TEXT DEFAULT 'running', rentals_processed INT DEFAULT 0, charges_created INT DEFAULT 0, messages_enqueued INT DEFAULT 0, details JSONB DEFAULT '{}', idempotency_key TEXT NOT NULL, started_at TIMESTAMPTZ DEFAULT NOW(), finished_at TIMESTAMPTZ, CONSTRAINT uq_runs_idem UNIQUE (tenant_id, idempotency_key) );
    CREATE TABLE external_costs ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id UUID, provider TEXT, quantity INT DEFAULT 1, unit_cost NUMERIC(15,4) DEFAULT 0, amount NUMERIC(15,4) DEFAULT 0, currency TEXT DEFAULT 'BRL', cost_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW() );
    CREATE TABLE webhook_events ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT, provider TEXT NOT NULL, kind TEXT NOT NULL, external_event_id TEXT NOT NULL, received_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_webhook_event UNIQUE (provider, external_event_id) );
  `);

  const pg = db.adapters.createPg();
  pool = new pg.Pool();
  const dbId = require.resolve('../config/db');
  const stub = new Module(dbId); stub.filename = dbId; stub.loaded = true; stub.exports = pool;
  require.cache[dbId] = stub;

  M = require('../models/automationModels');
  rentalModel = require('../models/rentalModels');
  vehicleModel = require('../models/vehicleModels');
  billing = require('../services/automation/billingCycleService');
  dunning = require('../services/automation/dunningService');
  outbox = require('../services/automation/outboxService');
  payConfirm = require('../services/automation/paymentConfirmService');
  fiscalService = require('../services/automation/fiscalService');

  await pool.query(`INSERT INTO tenants (id, name, modules) VALUES ($1,'Locadora','["locacao"]'),($2,'Outra','["locacao"]')`, [T, T2]);
  cli = (await pool.query(`INSERT INTO clients (tenant_id, name, cpf, phone) VALUES ($1,'Maria','11111111111','+5521999990000') RETURNING *`, [T])).rows[0];
  veh = await vehicleModel.createVehicle({ tenant_id: T, plate: 'AAA1A11', brand: 'Fiat', model: 'Argo', daily_rate: 100, status: 'alugado' });
  rental = await rentalModel.createRental({ tenant_id: T, client_id: cli.id, vehicle_id: veh.id, status: 'em_andamento', start_date: '2027-01-01', end_date: '2027-01-08', daily_rate: 100 });

  // Habilita automação (janela ampla p/ processar a qualquer hora do teste).
  await M.updateSettings(T, {
    billing_enabled: true, whatsapp_enabled: true, billing_auto_create: true,
    whatsapp_send_start_hour: 0, whatsapp_send_end_hour: 24, cost_per_message: 0.05, reminder_max: 3,
  });
});

const NOW = new Date('2027-01-06T12:00:00Z'); // quarta

test('cobrança semanal: cria faturamento + cobrança + mensagem; reexecução é idempotente', async () => {
  const r1 = await billing.runBilling(T, { now: NOW });
  assert.equal(r1.charges_created, 1);
  assert.equal(r1.messages_enqueued, 1);

  const charges = (await pool.query('SELECT * FROM charges WHERE tenant_id=$1', [T])).rows;
  assert.equal(charges.length, 1);
  assert.equal(Number(charges[0].amount), 700);            // 100 × 7 diárias
  assert.ok(charges[0].pix_code, 'PIX sandbox gerado');
  const msgs = (await pool.query(`SELECT * FROM message_outbox WHERE tenant_id=$1 AND template_kind='billing'`, [T])).rows;
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].body, /Maria/);
  assert.match(msgs[0].body, /SANDBOX/);                   // pix renderizado

  // Reexecução na mesma semana → idempotente (sem 2ª cobrança/mensagem).
  const r2 = await billing.runBilling(T, { now: NOW, force: true });
  assert.equal(r2.skipped, 'already_ran');
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM charges WHERE tenant_id=$1', [T])).rows[0].n, 1);
});

test('outbox: processa em sandbox → sent + custo registrado', async () => {
  const res = await outbox.process(T, { now: NOW });
  assert.ok(res.sent >= 1);
  const sent = (await pool.query(`SELECT * FROM message_outbox WHERE tenant_id=$1 AND status='sent'`, [T])).rows;
  assert.ok(sent.length >= 1);
  assert.ok(sent[0].external_id, 'external_id do provider');
  const costs = (await pool.query(`SELECT * FROM external_costs WHERE tenant_id=$1 AND kind='whatsapp_message'`, [T])).rows;
  assert.ok(costs.length >= 1);
  assert.equal(Number(costs[0].amount), 0.05);
});

test('inadimplência: enfileira lembrete; idempotente por dia; respeita limite', async () => {
  const d1 = await dunning.runDunning(T, { now: NOW });
  assert.equal(d1.enqueued, 1);
  const d1b = await dunning.runDunning(T, { now: NOW });     // mesmo dia → sem duplicar
  assert.equal(d1b.enqueued, 0);
  // Dias seguintes até o limite (reminder_max=3): já há 1, cabem +2.
  await dunning.runDunning(T, { now: new Date('2027-01-07T12:00:00Z') });
  await dunning.runDunning(T, { now: new Date('2027-01-08T12:00:00Z') });
  const d4 = await dunning.runDunning(T, { now: new Date('2027-01-09T12:00:00Z') }); // limite atingido
  assert.equal(d4.enqueued, 0);
  const reminders = (await pool.query(`SELECT COUNT(*)::int n FROM message_outbox WHERE tenant_id=$1 AND template_kind='reminder' AND status<>'canceled'`, [T])).rows[0].n;
  assert.equal(reminders, 3);
});

test('pagamento (webhook sandbox): confirma pagamento real, para lembretes, é idempotente', async () => {
  const charge = (await pool.query('SELECT * FROM charges WHERE tenant_id=$1 LIMIT 1', [T])).rows[0];
  const body = { event_id: 'evt-pay-1', charge_external_id: charge.external_id, status: 'paid', amount: charge.amount };

  const r = await payConfirm.handleWebhook('null', body, { now: NOW });
  assert.equal(r.confirmed, true);

  // Pagamento real criado + entrada financeira (financeiro reutilizado).
  const pays = (await pool.query(`SELECT * FROM payments WHERE tenant_id=$1 AND billing_id=$2 AND status='confirmado'`, [T, charge.billing_id])).rows;
  assert.equal(pays.length, 1);
  const tx = (await pool.query(`SELECT * FROM financial_transactions WHERE payment_id=$1`, [pays[0].id])).rows;
  assert.equal(tx.length, 1);
  assert.equal(tx[0].type, 'entrada');
  // Cobrança paga + lembretes cancelados + confirmação enfileirada.
  assert.equal((await pool.query('SELECT status FROM charges WHERE id=$1', [charge.id])).rows[0].status, 'paid');
  const remindersOpen = (await pool.query(`SELECT COUNT(*)::int n FROM message_outbox WHERE charge_id=$1 AND template_kind='reminder' AND status<>'canceled'`, [charge.id])).rows[0].n;
  assert.equal(remindersOpen, 0, 'lembretes cancelados');
  const conf = (await pool.query(`SELECT COUNT(*)::int n FROM message_outbox WHERE tenant_id=$1 AND template_kind='payment_confirmed'`, [T])).rows[0].n;
  assert.equal(conf, 1);

  // Reprocessar o mesmo evento → NÃO duplica pagamento/entrada/mensagem.
  const r2 = await payConfirm.handleWebhook('null', body, { now: NOW });
  assert.equal(r2.duplicate, true);
  assert.equal((await pool.query(`SELECT COUNT(*)::int n FROM payments WHERE billing_id=$1 AND status='confirmado'`, [charge.billing_id])).rows[0].n, 1);
});

test('fiscal: desabilitado → nada; habilitado sem provedor → pending_configuration (não emite)', async () => {
  const pay = (await pool.query(`SELECT id FROM payments WHERE tenant_id=$1 LIMIT 1`, [T])).rows[0];
  const off = await fiscalService.issueForPayment(T, pay.id, {});
  assert.equal(off.skipped, 'fiscal_disabled');

  await M.updateSettings(T, { fiscal_enabled: true, fiscal_mode: 'after_payment', fiscal_document_type: 'nfse' });
  const doc = await fiscalService.issueForPayment(T, pay.id, {});
  assert.equal(doc.status, 'pending_configuration');
  assert.match(doc.error_message || '', /Configuração fiscal incompleta/);
  // Idempotente: 2ª chamada devolve o mesmo doc.
  const doc2 = await fiscalService.issueForPayment(T, pay.id, {});
  assert.equal(doc2.id, doc.id);
});

test('custos externos: relatório agrega por tipo e isola por tenant', async () => {
  const rep = await M.costReport(T, {});
  assert.ok(rep.by_kind.some((k) => k.kind === 'whatsapp_message'));
  assert.equal((await M.costReport(T2, {})).by_kind.length, 0, 'outro tenant sem custos');
});

test('isolamento: cobrança/mensagens/cobranças de T não aparecem em T2', async () => {
  assert.equal((await M.listOutbox(T2, {})).length, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM charges WHERE tenant_id=$1', [T2])).rows[0].n, 0);
});
